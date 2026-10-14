// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {NightshiftOracle} from "./NightshiftOracle.sol";

interface IGroth16Verifier {
    function verifyProof(uint256[2] calldata pA, uint256[2][2] calldata pB, uint256[2] calldata pC, uint256[3] calldata pubSignals)
        external
        view
        returns (bool);
}

interface IVaultMarkets {
    function markets(address collateral) external view returns (bool enabled, uint256 lltv);
}

/// @title CloakRegistry: on-chain checks for Cloak solvency proofs.
/// @notice The Groth16 verifier alone only shows "solvent at the price and LLTV the prover chose". This registry
///         also requires the proof's public price to match NightshiftOracle (within PRICE_TOLERANCE_BPS, from a
///         fresh price) and its LLTV to match the Vault market, so an accepted proof means "solvent at the
///         protocol's own price". `check` is a free read; `attest` records an accepted proof by its commitment.
///         Public signals: [commitment, priceCents, lltvBps].
contract CloakRegistry {
    IGroth16Verifier public immutable verifier;
    NightshiftOracle public immutable oracle;
    IVaultMarkets public immutable vault;
    uint256 public constant PRICE_TOLERANCE_BPS = 100; // 1%: the on-chain price trails the live Oracle by one keeper run
    uint256 public constant MAX_PRICE_AGE = 1 days;

    struct Attestation {
        address token;
        uint64 priceCents;
        uint32 lltvBps;
        uint64 at;
        address by;
    }

    /// @notice commitment => the accepted proof's public terms
    mapping(uint256 => Attestation) public attestations;

    event Attested(uint256 indexed commitment, address indexed token, uint256 priceCents, uint256 lltvBps, address indexed by);

    constructor(IGroth16Verifier verifier_, NightshiftOracle oracle_, IVaultMarkets vault_) {
        require(address(verifier_) != address(0) && address(oracle_) != address(0) && address(vault_) != address(0), "zero");
        verifier = verifier_;
        oracle = oracle_;
        vault = vault_;
    }

    /// @return ok true when the proof is valid AND its price and LLTV are the protocol's
    /// @return reason "" when ok, otherwise which check failed
    function check(address token, uint256[2] calldata pA, uint256[2][2] calldata pB, uint256[2] calldata pC, uint256[3] calldata pubSignals)
        public
        view
        returns (bool ok, string memory reason)
    {
        (uint256 p, , uint64 updatedAt) = oracle.getPrice(token);
        if (p == 0) return (false, "no price");
        if (block.timestamp - updatedAt > MAX_PRICE_AGE) return (false, "stale price");
        uint256 oracleCents = p / 1e16;
        uint256 proofCents = pubSignals[1];
        uint256 diff = proofCents > oracleCents ? proofCents - oracleCents : oracleCents - proofCents;
        if (diff * 10_000 > oracleCents * PRICE_TOLERANCE_BPS) return (false, "price differs from oracle");
        (bool enabled, uint256 lltv) = vault.markets(token);
        if (!enabled) return (false, "market");
        if (pubSignals[2] != lltv / 1e14) return (false, "lltv differs from market");
        if (!verifier.verifyProof(pA, pB, pC, pubSignals)) return (false, "invalid proof");
        return (true, "");
    }

    function attest(address token, uint256[2] calldata pA, uint256[2][2] calldata pB, uint256[2] calldata pC, uint256[3] calldata pubSignals)
        external
    {
        (bool ok, string memory reason) = check(token, pA, pB, pC, pubSignals);
        require(ok, reason);
        attestations[pubSignals[0]] = Attestation(token, uint64(pubSignals[1]), uint32(pubSignals[2]), uint64(block.timestamp), msg.sender);
        emit Attested(pubSignals[0], token, pubSignals[1], pubSignals[2], msg.sender);
    }
}

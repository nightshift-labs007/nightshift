// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title NightshiftSignalsLedger
/// @notice Timestamps every Nightshift Signals basket before anyone sees it. Holds no funds and no state:
///         the record is the event log. Anyone can keccak256 a basket's public canonical JSON and
///         match it to the BasketCommitted event for keccak256(basket id).
contract NightshiftSignalsLedger {
    address public immutable committer;

    event BasketCommitted(bytes32 indexed basketId, bytes32 hash, uint64 ts);

    error NotCommitter();
    error LengthMismatch();

    constructor(address committer_) {
        committer = committer_;
    }

    function commit(bytes32 basketId, bytes32 hash) external {
        if (msg.sender != committer) revert NotCommitter();
        emit BasketCommitted(basketId, hash, uint64(block.timestamp));
    }

    /// @notice Baskets that land in the same second share one transaction.
    function commitBatch(bytes32[] calldata basketIds, bytes32[] calldata hashes) external {
        if (msg.sender != committer) revert NotCommitter();
        if (basketIds.length != hashes.length) revert LengthMismatch();
        for (uint256 i; i < basketIds.length; ++i) {
            emit BasketCommitted(basketIds[i], hashes[i], uint64(block.timestamp));
        }
    }
}

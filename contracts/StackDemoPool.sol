// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IStackToken, IStackOracle} from "./StackPlan.sol";

/// @title StackDemoPool: a stand-in for a DEX pool, for the Base demo only.
/// @notice There is no real silver or gold pool on Base, only Nightshift's valueless demo tokens. This contract sells
///         them for the loan token at the Oracle price plus a spread the owner sets per asset. Widen the spread to
///         watch Stack skip a buy as "price too high"; narrow it to watch one fill. The guard in StackPlan is
///         unchanged when the real Uniswap route replaces this pool on Robinhood Chain.
///         It holds inventory the team seeds; it is not a market and has no value.
contract StackDemoPool {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;

    address public owner;
    IStackToken public immutable loanToken;
    IStackOracle public immutable oracle;
    /// @notice Premium over the Oracle price in basis points; negative means a discount. Between -200 and +1000.
    mapping(address => int256) public spreadBps;

    event Bought(address indexed buyer, address indexed asset, uint256 amountIn, uint256 out, uint256 price);
    event SpreadSet(address indexed asset, int256 bps);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor(IStackToken loanToken_, IStackOracle oracle_) {
        owner = msg.sender;
        loanToken = loanToken_;
        oracle = oracle_;
    }

    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, "owner");
        require(newOwner != address(0), "zero");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setSpread(address asset, int256 bps) external {
        require(msg.sender == owner, "owner");
        require(bps >= -200 && bps <= 1000, "range");
        spreadBps[asset] = bps;
        emit SpreadSet(asset, bps);
    }

    /// @notice What this pool charges per token right now (USD, 18 decimals).
    function priceOf(address asset) public view returns (uint256) {
        (uint256 p, , ) = oracle.getPrice(asset);
        require(p > 0, "no price");
        return uint256(int256(p) * (int256(BPS) + spreadBps[asset]) / int256(BPS));
    }

    function quote(address asset, uint256 amountIn) public view returns (uint256) {
        uint256 value = (amountIn * WAD) / (10 ** loanToken.decimals());
        return (value * WAD) / priceOf(asset);
    }

    function buy(address asset, uint256 amountIn, uint256 minOut, address to) external returns (uint256 out) {
        out = quote(asset, amountIn);
        require(out >= minOut && out > 0, "slippage");
        require(IStackToken(asset).balanceOf(address(this)) >= out, "inventory");
        require(loanToken.transferFrom(msg.sender, address(this), amountIn), "pay");
        require(IStackToken(asset).transfer(to, out), "deliver");
        emit Bought(msg.sender, asset, amountIn, out, priceOf(asset));
    }

    /// @notice Takes back inventory or collected loan tokens.
    function sweep(address token, address to, uint256 amount) external {
        require(msg.sender == owner, "owner");
        require(IStackToken(token).transfer(to, amount), "sweep");
    }
}

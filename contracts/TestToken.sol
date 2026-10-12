// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title TestToken: minimal ERC-20 for the Nightshift testnet demo.
/// @notice Anyone can claim a small amount every hour; the owner and approved minters (the faucet wallet) can mint.
contract TestToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    address public owner;
    uint256 public immutable faucetAmount;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public lastClaim;
    mapping(address => bool) public isMinter;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event MinterSet(address indexed minter, bool allowed);

    constructor(string memory name_, string memory symbol_, uint256 faucetAmount_) {
        name = name_;
        symbol = symbol_;
        faucetAmount = faucetAmount_;
        owner = msg.sender;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "allowance");
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    /// @notice Test-token faucet: `faucetAmount` once per hour per address.
    function faucet() external {
        require(block.timestamp >= lastClaim[msg.sender] + FAUCET_COOLDOWN, "faucet cooldown");
        lastClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, faucetAmount);
    }

    /// @notice Lets a separate faucet wallet mint test tokens without holding the owner key.
    function setMinter(address minter, bool allowed) external {
        require(msg.sender == owner, "owner");
        isMinter[minter] = allowed;
        emit MinterSet(minter, allowed);
    }

    function mint(address to, uint256 value) external {
        require(msg.sender == owner || isMinter[msg.sender], "minter");
        _mint(to, value);
    }

    function _mint(address to, uint256 value) internal {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(balanceOf[from] >= value, "balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}

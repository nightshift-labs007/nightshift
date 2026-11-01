// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {NightshiftSignalsLedger} from "../contracts/NightshiftSignalsLedger.sol";

contract NightshiftSignalsLedgerTest is Test {
    event BasketCommitted(bytes32 indexed basketId, bytes32 hash, uint64 ts);

    NightshiftSignalsLedger ledger;
    address committer = address(0xC0FFEE);

    function setUp() public {
        ledger = new NightshiftSignalsLedger(committer);
    }

    function test_commitEmitsEvent() public {
        vm.warp(1_761_000_000);
        vm.expectEmit(true, false, false, true);
        emit BasketCommitted(keccak256("bkt_20261021_0214_a"), bytes32(uint256(1)), 1_761_000_000);
        vm.prank(committer);
        ledger.commit(keccak256("bkt_20261021_0214_a"), bytes32(uint256(1)));
    }

    function test_onlyCommitter() public {
        vm.expectRevert(NightshiftSignalsLedger.NotCommitter.selector);
        ledger.commit(bytes32(0), bytes32(0));
    }

    function test_batchLengthsMustMatch() public {
        bytes32[] memory ids = new bytes32[](2);
        bytes32[] memory hashes = new bytes32[](1);
        vm.prank(committer);
        vm.expectRevert(NightshiftSignalsLedger.LengthMismatch.selector);
        ledger.commitBatch(ids, hashes);
    }
}

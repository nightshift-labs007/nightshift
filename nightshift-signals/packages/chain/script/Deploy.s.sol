// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {NightshiftSignalsLedger} from "../contracts/NightshiftSignalsLedger.sol";

/// forge script script/Deploy.s.sol --rpc-url robinhood --broadcast
/// Deploy to Robinhood Chain testnet first. COMMITTER_ADDRESS is the gas-only key the committer uses.
contract Deploy is Script {
    function run() external returns (NightshiftSignalsLedger ledger) {
        vm.startBroadcast();
        ledger = new NightshiftSignalsLedger(vm.envAddress("COMMITTER_ADDRESS"));
        vm.stopBroadcast();
    }
}

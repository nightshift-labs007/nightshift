pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

// Nightshift Cloak: prove a hidden loan is safely backed at the Oracle's price.
//
// Public:  priceCents (Oracle fair value), lltvBps (market liquidation LTV), commitment (output)
// Private: units (collateral, 1e-4 token units), debtCents (USDG debt), salt
//
// Proves:  units * price * lltv > debt          (health factor > 1)
//          commitment == Poseidon(units, debtCents, salt)
template Solvency() {
    signal input priceCents;
    signal input lltvBps;
    signal input units;
    signal input debtCents;
    signal input salt;
    signal output commitment;

    // Range checks so the products below can't wrap around the field.
    component rUnits = Num2Bits(64);
    rUnits.in <== units;
    component rDebt = Num2Bits(64);
    rDebt.in <== debtCents;
    component rPrice = Num2Bits(40);
    rPrice.in <== priceCents;
    component rLltv = Num2Bits(14);
    rLltv.in <== lltvBps;

    // capacity is in 1e-8 cents (1e-4 units x 1e-4 bps); scale debt to match.
    signal value;
    value <== units * priceCents;
    signal capacity;
    capacity <== value * lltvBps;
    signal need;
    need <== debtCents * 100000000;

    component gt = GreaterThan(120);
    gt.in[0] <== capacity;
    gt.in[1] <== need;
    gt.out === 1;

    component h = Poseidon(3);
    h.inputs[0] <== units;
    h.inputs[1] <== debtCents;
    h.inputs[2] <== salt;
    commitment <== h.out;
}

component main {public [priceCents, lltvBps]} = Solvency();

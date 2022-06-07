pragma solidity 0.8.11;

import "../contracts/SafeToken.sol";

contract SafeTokenHarness is SafeToken {
    // adding the completely valid 'view' declaration to this function causes gas usage test in SafeTokenHarnessTest.js
    // to fail because the result of calling this function is 'undefined.'
    // TODO: Figure out how SafeTokenHarnessTest of checkInboundTransfer can be modified so it doesn't fail if this is declared as view
    function checkInboundTransfer(
        address asset,
        address from,
        uint256 amount
    ) public returns (bool) {
        checkTransferIn(asset, from, amount);

        return(true);
    }

    function doInboundTransfer(
        address asset,
        address from,
        uint256 amount
    ) public returns (bool) {
        bool err = doTransferIn(asset, from, amount);

        return err;
    }

    function doOutboundTransfer(
        address asset,
        address to,
        uint256 amount
    ) public returns (bool) {
        bool err = doTransferOut(asset, to, amount);

        return (err);
    }
}
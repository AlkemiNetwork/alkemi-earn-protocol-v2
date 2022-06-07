// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface AlkemiVerifiedInterface{

    function getAccountLiquidity(address account) external view returns (int256);
    function getSupplyBalance(address account, address asset) external view returns (uint256);
    function getBorrowBalance(address account, address asset) external view returns (uint256);
    function assetPrices(address asset) external view returns (uint256);
    function getMarketTotalSupplyVerified(address market) external view returns(uint256);
    function getMarketTotalBorrowVerified(address market) external view returns(uint256);
}
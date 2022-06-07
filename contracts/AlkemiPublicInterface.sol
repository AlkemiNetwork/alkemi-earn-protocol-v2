// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface AlkemiPublicInterface{
    function getCollateralMarketsLength() external view returns (uint256);
    function getAccountLiquidity(address account) external view returns (int256);
    function getSupplyBalance(address account, address asset) external view returns (uint256);
    function getBorrowBalance(address account, address asset) external view returns (uint256);
    function assetPrices(address asset) external view returns (uint256);
    function getMarketTotalSupplyPublic(address market) external view returns(uint256);
    function getMarketTotalBorrowPublic(address market) external view returns(uint256);
}
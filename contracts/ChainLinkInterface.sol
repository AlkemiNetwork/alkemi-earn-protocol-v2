// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface ChainLinkInterface{

    /**
     * Returns false if the contract is paused
     */
    function isChainlinkContractPaused() external view returns(bool);

     /**
     * Returns the latest price scaled to 1e18 scale
     */
    function getAssetPrice(address asset) external view returns (uint256, uint8);
}
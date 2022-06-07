// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;


contract testChainlink{
   
  


    /**
     * Returns the latest price scaled to 1e18 scale
     */
    function getAssetPrice(address asset) external view returns (uint256, uint8) {
       
        // Capture the decimals in the ERC20 token
        uint8 assetDecimals = 18;
       
            return (0, assetDecimals);
        
    }

    
}
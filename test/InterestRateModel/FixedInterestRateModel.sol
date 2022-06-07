// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

contract FixedInterestRateModel {
    uint256 supplyRate;
    uint256 borrowRate;

    constructor(uint256 supplyRate_, uint256 borrowRate_) {
        supplyRate = supplyRate_;
        borrowRate = borrowRate_;
        supplyRate = 1 * 10**17;
        borrowRate = 5 * 10**17;
    }

  
    function getSupplyRate(
        address _asset,
        uint256 _cash,
        uint256 _borrows
    ) public view returns (bool, uint256) {
        
        return (true, supplyRate);
    }


    function getBorrowRate(
        address _asset,
        uint256 _cash,
        uint256 _borrows
    ) public view returns (bool, uint256) {
        
        return (true, borrowRate);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../contracts/AlkemiEarnPublic.sol";

contract AlkemiEarnPublicHarness is AlkemiEarnPublic {
    mapping(address => uint256) internal cashOverrides;

    mapping(address => bool) accountsToFailLiquidity;

    mapping(address => Exp) liquidityShortfalls;

    mapping(address => Exp) liquiditySurpluses;

    bool internal failBorrowDenominatedCollateralCalculation;

    bool internal failCalculateAmountSeize;

    
    mapping(address => Exp) public assetPrice;

    bool useOracle = false;


   
    function harnessSetCash(address asset, uint256 cashAmount) public {
        cashOverrides[asset] = cashAmount;
    }


    function calculateAmountSeize1(
        Exp memory underwaterAssetPrice,
        Exp memory collateralPrice,
        uint256 amountCloseOfBorrow
    ) internal view returns ( uint256) {
        if (failCalculateAmountSeize) {
            return (0);
        }

        return
            super.calculateAmountSeize(
                underwaterAssetPrice,
                collateralPrice,
                amountCloseOfBorrow
            );
    }

    

    function harnessSetAccountBorrowBalance(
        address account,
        address asset,
        uint256 principal,
        uint256 interestIndex
    ) public {
        borrowBalances[account][asset] = Balance({
            principal: principal,
            interestIndex: interestIndex
        });
    }

     function harnessSetAssetPrice(
        address asset,
        uint256 priceNum,
        uint256 priceDenom
    ) public {
        ( Exp memory assetPrice) = getExp(priceNum, priceDenom);

        setAssetPriceInternal(asset, assetPrice);
    }

   
       function harnessSetMarketDetails(
        address asset,
        uint256 totalSupply,
        uint256 supplyRateBasisPoints,
        uint256 supplyIndex,
        uint256 totalBorrows,
        uint256 borrowRateBasisPoints,
        uint256 borrowIndex
    ) public {
        ( Exp memory supplyRate) = getExp(
            supplyRateBasisPoints,
            10000
        );
        (Exp memory borrowRate) = getExp(
            borrowRateBasisPoints,
            10000
        );

        markets[asset].blockNumber = block.number;
        markets[asset].totalSupply = totalSupply;
        markets[asset].supplyRateMantissa = supplyRate.mantissa;
        markets[asset].supplyIndex = supplyIndex;
        markets[asset].totalBorrows = totalBorrows;
        markets[asset].borrowRateMantissa = borrowRate.mantissa;
        markets[asset].borrowIndex = borrowIndex;
    }
  
    function setAssetPriceInternal(address asset, Exp memory price) internal {
        assetPrice[asset] = price;
    }

    


     function harnessSetCollateralRatio(uint256 ratioNum, uint256 ratioDenom)
        public
    {
        ( Exp memory collateralRatioExp) = getExp(
            ratioNum,
            ratioDenom
        );

        collateralRatio = collateralRatioExp;
    }
    function harnessCalculateInterestIndex(
        uint256 startingInterestIndex,
        uint256 interestRateBasisPoints,
        uint256 blockDelta
    ) public pure returns (uint256) {

        ( Exp memory interestRate) = getExp(
            interestRateBasisPoints,
            10000
        );

        (uint256 newInterestIndex) = calculateInterestIndex(
            startingInterestIndex,
            interestRate.mantissa,
            0,
            blockDelta
        );

        return newInterestIndex;
    }

    function harnessSetMarketBlockNumber(address asset, uint256 newBlockNumber)
        public
    {
        markets[asset].blockNumber = newBlockNumber;
    }

        function harnessSetAccountSupplyBalance(
        address account,
        address asset,
        uint256 principal,
        uint256 interestIndex
    ) public {
        supplyBalances[account][asset] = Balance({
            principal: principal,
            interestIndex: interestIndex
        });
    }

      function harnessAddCollateralMarket(address asset) public {
        addCollateralMarket(asset);
    }

    function harnessSetOracle(address newOracle) public {
        priceOracle = ChainLinkInterface(newOracle);
    }
      function harnessSetLiquidationDiscount(uint256 mantissa) public {
        liquidationDiscount = Exp({mantissa: mantissa});
    }

      function harnessSetFailBorrowDenominatedCollateralCalculation(bool state)
        public
    {
        failBorrowDenominatedCollateralCalculation = state;
    }

    function harnessSetFailCalculateAmountSeize(bool state) public {
        failCalculateAmountSeize = state;
    }
     function harnessSetUseOracle(bool _useOracle) public {
        useOracle = _useOracle;
    }
   function harnessSetAssetPriceMantissa(address asset, uint256 priceMantissa)
        public
    {
        setAssetPriceInternal(asset, Exp({mantissa: priceMantissa}));
    }

    function harnessSupportMarket(address asset) public {
        markets[asset].isSupported = true;
    }


}

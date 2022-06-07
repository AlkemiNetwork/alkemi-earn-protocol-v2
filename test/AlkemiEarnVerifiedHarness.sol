pragma solidity 0.8.11;

import "../contracts/AlkemiEarnVerified.sol";

contract AlkemiEarnVerifiedHarness is AlkemiEarnVerified {
    mapping(address => uint256) internal cashOverrides;

    mapping(address => bool) accountsToFailLiquidity;

   // mapping(address => Exp) liquidityShortfalls;

  //  mapping(address => Exp) liquiditySurpluses;

    bool public failBorrowDenominatedCollateralCalculation;

    bool public failCalculateAmountSeize;

    /**
     * @dev Mapping of asset addresses and their corresponding price in terms of Eth-Wei
     *      which is simply equal to AssetWeiPrice * 10e18. For instance, if OMG token was
     *      worth 5x Eth then the price for OMG would be 5*10e18 or Exp({mantissa: 5000000000000000000}).
     *      If useOracle is false (its default), then we use this map for prices.
     * map: assetAddress -> Exp
     */
    mapping(address => Exp) internal  assetPrice;

    bool useOracle = false;

   
    function getCash1(address asset) internal returns (uint) {
        uint override1 = cashOverrides[asset];
        if (override1 > 0) {
            return override1;
        }
        return super.getCash(asset);
    }

      function harnessSetOracle(address newOracle) public {
        priceOracle = ChainLinkInterface(newOracle);
    }

     function harnessSetUseOracle(bool _useOracle) public {
        useOracle = _useOracle;
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
        (Exp memory supplyRate) = getExp(
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

    function harnessSetMarketBlockNumber(address asset, uint256 newBlockNumber)
        public
    {
        markets[asset].blockNumber = newBlockNumber;
    }

       function harnessSetCash(address asset, uint256 cashAmount) public {
        cashOverrides[asset] = cashAmount;
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

    function harnessSetFailLiquidityCheck(address account, bool setting)
        public
    {
        accountsToFailLiquidity[account] = setting;
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

    function harnessSupportMarket(address asset) public {
        markets[asset].isSupported = true;
    }
    function harnessAddCollateralMarket(address asset) public {
        addCollateralMarket(asset);
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

    function harnessSetAssetPrice(
        address asset,
        uint256 priceNum,
        uint256 priceDenom
    ) public {
        (Exp memory assetPrice) = getExp(priceNum, priceDenom);

        setAssetPriceInternal(asset, assetPrice);
    }

    function harnessSetAssetPriceMantissa(address asset, uint256 priceMantissa)
        public
    {
        setAssetPriceInternal(asset, Exp({mantissa: priceMantissa}));
    }


   
   
    function setAssetPriceInternal(address asset, Exp memory price) internal {
        assetPrice[asset] = price;
    }

    



}
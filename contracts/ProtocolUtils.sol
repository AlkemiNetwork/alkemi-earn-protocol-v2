// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./Exponential.sol";
import "./ChainLinkInterface.sol";
import {Error} from "./ErrorReporter.sol";

contract ProtocolUtils is Exponential{
    
    ChainLinkInterface public priceOracle;
  
    /**
     * @dev Gets the amount of the specified asset given the specified Eth value
     *      ethValue / oraclePrice = assetAmountWei
     *      If there's no oraclePrice, this returns (Error.DIVISION_BY_ZERO, 0)
     * @return Return value is expressed in a magnified scale per token decimals
     */
    
    function getAssetAmountForValue(address asset, Exp memory ethValue)
        internal
        view
        returns (uint256)
    {
        Exp memory assetPrice;
        Exp memory assetAmount;

        assetPrice = fetchAssetPrice(asset);

        assetAmount = divExp(ethValue, assetPrice);

        return (truncate(assetAmount));
    }

    
     /**
     * @dev fetches the price of asset from the PriceOracle and converts it to Exp
     * @param asset asset whose price should be fetched
     * @return Return value is expressed in a magnified scale per token decimals
     */
    function fetchAssetPrice(address asset)
        internal
        view
        returns (Exp memory)
    {
        bool paused = priceOracle.isChainlinkContractPaused();
        require(address(priceOracle) != address(0), Error.ZERO_ORACLE_ADDRESS);

        require(!paused, Error.MISSING_ASSET_PRICE); 

        (uint256 priceMantissa, uint8 assetDecimals) = priceOracle
        .getAssetPrice(asset);
        (bool success, uint256 magnification) = sub(18, uint256(assetDecimals));
        require(success, Error.INTEGER_UNDERFLOW);

        (success, priceMantissa) = mul(priceMantissa, 10**magnification);
        require(success, Error.INTEGER_OVERFLOW);

        return (Exp({mantissa: priceMantissa}));
    }    
    
     /**
     * @dev Gets the price for the amount specified of the given asset.
     * @return Return value is expressed in a magnified scale per token decimals
     */
    function getPriceForAssetAmount(address asset, uint256 assetAmount)
        internal
        view
        returns (Exp memory)
    {
        Exp memory assetPrice = fetchAssetPrice(asset);

        require(!isZeroExp(assetPrice), Error.MISSING_ASSET_PRICE); 

        return mulScalar(assetPrice, assetAmount); // assetAmountWei * oraclePrice = assetValueInEth
    }  
    
        /**
     * @dev Calculates a new supply/borrow index based on the prevailing interest rates applied over time
     *      This is defined as `we multiply the most recent supply/borrow index by (1 + blocks times rate)`
     * @return Return value is expressed in 1e18 scale
     */
    function calculateInterestIndex(
        uint256 startingInterestIndex,
        uint256 interestRateMantissa,
        uint256 blockStart,
        uint256 blockEnd
    )   internal pure returns (uint256) {
        // Get the block delta
        (bool success, uint256 blockDelta) = sub(blockEnd, blockStart);
        require(success, Error.INTEGER_UNDERFLOW);

        // Scale the interest rate times number of blocks
        // Note: Doing Exp construction inline to avoid `CompilerError: Stack too deep, try removing local variables.`
        Exp memory blocksTimesRate = mulScalar(
            Exp({mantissa: interestRateMantissa}),
            blockDelta
        );

        // Add one to that result (which is really Exp({mantissa: expScale}) which equals 1.0)
        Exp memory onePlusBlocksTimesRate = addExp(
            blocksTimesRate,
            Exp({mantissa: expScale})
        );

        // Then scale that accumulated interest by the old interest index to get the new interest index
        Exp memory newInterestIndexExp = mulScalar(
            onePlusBlocksTimesRate,
            startingInterestIndex
        );

        // Finally, truncate the interest index. This works only if interest index starts large enough
        // that is can be accurately represented with a whole number.
        return (truncate(newInterestIndexExp));
    }

    /**
     * @dev Calculates a new balance based on a previous balance and a pair of interest indices
     *      This is defined as: `The user's last balance checkpoint is multiplied by the currentSupplyIndex
     *      value and divided by the user's checkpoint index value`
     * @return Return value is expressed in 1e18 scale
     */
    function calculateBalance(
        uint256 startingBalance,
        uint256 interestIndexStart,
        uint256 interestIndexEnd
    )   internal pure returns (bool, uint256) {
        if (startingBalance == 0) {
            // We are accumulating interest on any previous balance; if there's no previous balance, then there is
            // nothing to accumulate.
            return (true, 0);
        }
        (bool success, uint256 balanceTimesIndex) = mul(
            startingBalance,
            interestIndexEnd
        );
        require(success, Error.INTEGER_OVERFLOW);

        return div(balanceTimesIndex, interestIndexStart);
    }

}
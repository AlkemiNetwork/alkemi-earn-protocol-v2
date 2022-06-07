// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;
import "./Exponential.sol";
import {Error} from "./ErrorReporter.sol";

/**
 * @title  Earn Interest Rate Model
 * @author ShiftForex
 * @notice See Model here
 */

contract AlkemiRateModel is Exponential {
    // Assuming avg. block time of 13.3 seconds; can be updated using changeBlocksPerYear() by the admin
    uint256 public blocksPerYear = 2371128;

    address public owner;
    address public newOwner;

    string contractName;

    uint8 private hundred = 100;

    modifier onlyOwner() {
        require(msg.sender == owner, Error.UNAUTHORIZED);
        _;
    }

    event OwnerUpdate(address indexed owner, address indexed newOwner);

    event blocksPerYearUpdated(
        uint256 oldBlocksPerYear,
        uint256 newBlocksPerYear
    );

    Exp internal SpreadLow;
    Exp internal BreakPointLow;
    Exp internal ReserveLow;
    Exp internal ReserveMid;
    Exp internal SpreadMid;
    Exp internal BreakPointHigh;
    Exp internal ReserveHigh;
    Exp internal SpreadHigh;

    Exp internal MinRateActual;
    Exp internal HealthyMinURActual;
    Exp internal HealthyMinRateActual;
    Exp internal MaxRateActual;
    Exp internal HealthyMaxURActual;
    Exp internal HealthyMaxRateActual;

    constructor(
        string memory _contractName,
        uint256 MinRate,
        uint256 HealthyMinUR,
        uint256 HealthyMinRate,
        uint256 HealthyMaxUR,
        uint256 HealthyMaxRate,
        uint256 MaxRate
    ) {
        // Remember to enter percentage times 100. ex., if it is 2.50%, enter 250
        // Checks for reasonable interest rate parameters
        require(MinRate < MaxRate, Error.MIN_RATE_GREATER_THAN_MAX_RATE);
        require(
            HealthyMinUR < HealthyMaxUR,
            Error.HEALTHLY_MINUR_GREATER_THAN_HEALTHLY_MAXUR
        );
        require(
            HealthyMinRate < HealthyMaxRate,
            Error.HEALTHLY_MINUR_GREATER_THAN_HEALTHLY_MAXUR
        );
        owner = msg.sender;
        changeRates(
            _contractName,
            MinRate,
            HealthyMinUR,
            HealthyMinRate,
            HealthyMaxUR,
            HealthyMaxRate,
            MaxRate
        );
    }

    function changeRates(
        string memory _contractName,
        uint256 MinRate,
        uint256 HealthyMinUR,
        uint256 HealthyMinRate,
        uint256 HealthyMaxUR,
        uint256 HealthyMaxRate,
        uint256 MaxRate
    ) public onlyOwner {
        // Remember to enter percentage times 100. ex., if it is 2.50%, enter 250 as solidity does not recognize floating point numbers
        // Checks for reasonable interest rate parameters
        require(MinRate < MaxRate, Error.MIN_RATE_GREATER_THAN_MAX_RATE);
        require(
            HealthyMinUR < HealthyMaxUR,
            Error.HEALTHLY_MINUR_GREATER_THAN_HEALTHLY_MAXUR
        );
        require(
            HealthyMinRate < HealthyMaxRate,
            Error.HEALTHLY_MINUR_GREATER_THAN_HEALTHLY_MAXUR
        );
        contractName = _contractName;
        Exp memory temp1;
        Exp memory temp2;
        Exp memory HundredMantissa;

        HundredMantissa = getExp(hundred, 1);
 
        // Rates are divided by 1e2 to scale down inputs to actual values
        // Inputs are expressed in percentage times 1e2, so we need to scale it down again by 1e2
        // Resulting values like MinRateActual etc., are represented in 1e20 scale
        // The return values for getSupplyRate() and getBorrowRate() functions are divided by 1e2 at the end to bring it down to 1e18 scale
        MinRateActual = getExp(MinRate, hundred);
        HealthyMinURActual = getExp(HealthyMinUR, hundred);
        HealthyMinRateActual = getExp(HealthyMinRate, hundred);
        MaxRateActual = getExp(MaxRate, hundred);
        HealthyMaxURActual = getExp(HealthyMaxUR, hundred);
        HealthyMaxRateActual = getExp(HealthyMaxRate, hundred);
        
        SpreadLow = MinRateActual;
        BreakPointLow = HealthyMinURActual;
        BreakPointHigh = HealthyMaxURActual;

        // ReserveLow = (HealthyMinRate-SpreadLow)/BreakPointLow;
        temp1 = subExp(HealthyMinRateActual, SpreadLow);
        ReserveLow = divExp(temp1, BreakPointLow);
        
        // ReserveMid = (HealthyMaxRate-HealthyMinRate)/(HealthyMaxUR-HealthyMinUR);
        temp1 = subExp(HealthyMaxRateActual, HealthyMinRateActual);
        temp2 = subExp(HealthyMaxURActual, HealthyMinURActual);
        ReserveMid = divExp(temp1, temp2);
        
        // SpreadMid = HealthyMinRate - (ReserveMid * BreakPointLow);
        temp1 = mulExp(ReserveMid, BreakPointLow);
        SpreadMid = subExp(HealthyMinRateActual, temp1);
        require(
            SpreadMid.mantissa >= 0,
            Error.SPREAD_MID_IS_NEGATIVE
        );
        // ReserveHigh = (MaxRate - HealthyMaxRate) / (100 - HealthyMaxUR);
        temp1 = subExp(MaxRateActual, HealthyMaxRateActual);
        temp2 = subExp(HundredMantissa, HealthyMaxURActual);
        ReserveHigh = divExp(temp1, temp2);
        
        // SpreadHigh = (ReserveHigh * BreakPointHigh) - HealthyMaxRate;
        temp2 = mulExp(ReserveHigh, BreakPointHigh);
        SpreadHigh = subExp(temp2, HealthyMaxRateActual);
        require(
            SpreadHigh.mantissa >= 0,
            Error.SPREAD_MAX_IS_NEGATIVE
        );
    }

    function changeBlocksPerYear(uint256 _blocksPerYear) external onlyOwner {
        uint256 oldBlocksPerYear = blocksPerYear;
        blocksPerYear = _blocksPerYear;
        emit blocksPerYearUpdated(oldBlocksPerYear, _blocksPerYear);
    }

    function transferOwnership(address newOwner_) external onlyOwner {
        require(newOwner_ != owner, Error.UNAUTHORIZED);
        newOwner = newOwner_;
    }

    function acceptOwnership() external {
        require(
            msg.sender == newOwner,
            Error.UNAUTHORIZED
        );
        emit OwnerUpdate(owner, newOwner);
        owner = newOwner;
        newOwner = address(0x0);
    }

    /*
     * @dev Calculates the utilization rate (borrows / (cash + borrows)) as an Exp in 1e18 scale
     */
    function getUtilizationRate(uint256 cash, uint256 borrows)
        internal
        view
        returns (bool, Exp memory)
    {
        if (borrows == 0) {
            // Utilization rate is zero when there's no borrows
            return (true, Exp({mantissa: 0}));
        }

        (bool success, uint256 cashPlusBorrows) = add(cash, borrows);
        if (!success) {
            return (
                false,
                Exp({mantissa: 0})
            );
        }

        Exp memory utilizationRate = getExp(
            borrows,
            cashPlusBorrows
        );
        
        utilizationRate = mulScalar(utilizationRate, hundred);

        return (true, utilizationRate);
    }

    /*
     * @dev Calculates the utilization and borrow rates for use by get{Supply,Borrow}Rate functions
     * Both Utilization Rate and Borrow Rate are returned in 1e18 scale
     */
    function getUtilizationAndAnnualBorrowRate(uint256 cash, uint256 borrows)
        internal
        view
        returns (
            bool,
            Exp memory,
            Exp memory
        )
    {
        (bool success, Exp memory utilizationRate) = getUtilizationRate(
            cash,
            borrows
        );
        if (!success) {
            return (false, Exp({mantissa: 0}), Exp({mantissa: 0}));
        }

        /**
         *  Borrow Rate
         *  0 < UR < 20% :      SpreadLow + UR * ReserveLow
         *  20% <= UR <= 80% :  SpreadMid + UR * ReserveMid
         *  80% < UR :          UR * ReserveHigh - SpreadHigh
         */

        uint256 annualBorrowRateScaled;
        Exp memory tempScaled;
        Exp memory tempScaled2;

        if (utilizationRate.mantissa < BreakPointLow.mantissa) {
            tempScaled = mulExp(utilizationRate, ReserveLow);
            tempScaled2 = addExp(tempScaled, SpreadLow);
            annualBorrowRateScaled = tempScaled2.mantissa;
        } else if (utilizationRate.mantissa > BreakPointHigh.mantissa) {
            tempScaled = mulExp(utilizationRate, ReserveHigh);
            // Integer Underflow is handled in sub() function under CarefulMath
            tempScaled2 = subExp(tempScaled, SpreadHigh);
            annualBorrowRateScaled = tempScaled2.mantissa;
        } else if (
            utilizationRate.mantissa >= BreakPointLow.mantissa &&
            utilizationRate.mantissa <= BreakPointHigh.mantissa
        ) {
            tempScaled = mulExp(utilizationRate, ReserveMid);
            tempScaled2 = addExp(tempScaled, SpreadMid);
            annualBorrowRateScaled = tempScaled2.mantissa;
        }

        return (
            true,
            utilizationRate,
            Exp({mantissa: annualBorrowRateScaled})
        );
    }

    /**
     * @notice Gets the current supply interest rate based on the given asset, total cash and total borrows
     * @dev The return value should be scaled by 1e18, thus a return value of
     *      `(true, 1000000000000)` implies an interest rate of 0.000001 or 0.0001% *per block*.
     * @param _asset The asset to get the interest rate of
     * @param cash The total cash of the asset in the market
     * @param borrows The total borrows of the asset in the market
     * @return Success or failure and the supply interest rate per block scaled by 1e18
     */
    function getSupplyRate(
        address _asset,
        uint256 cash,
        uint256 borrows
    ) public view returns (bool, uint256) {
        _asset; // pragma ignore unused argument
        (
            bool success,
            Exp memory utilizationRate0,
            Exp memory annualBorrowRate
        ) = getUtilizationAndAnnualBorrowRate(cash, borrows);
        if (!success) {
            return (false, 0);
        }

        /**
         *  Supply Rate
         *  = BorrowRate * utilizationRate * (1 - SpreadLow)
         */
        Exp memory temp1;
        Exp memory oneMinusSpreadBasisPoints;
        temp1 = getExp(hundred, 1);
        oneMinusSpreadBasisPoints = subExp(temp1, SpreadLow);

        // mulScalar only overflows when product is greater than or equal to 2^256.
        // utilization rate's mantissa is a number between [0e18,1e18]. That means that
        // utilizationRate1 is a value between [0e18,8.5e21]. This is strictly less than 2^256.

        // Next multiply this product times the borrow rate
        // Borrow rate should be divided by 1e2 to get product at 1e18 scale
        temp1 = mulExp(
            utilizationRate0,
            Exp({mantissa: annualBorrowRate.mantissa / hundred})
        );
        // If the product of the mantissas for mulExp are both less than 2^256,
        // then this operation will never fail.
        // We know that borrow rate is in the interval [0, 2.25e17] from above.
        // We know that utilizationRate1 is in the interval [0, 9e21] from directly above.
        // As such, the multiplication is in the interval of [0, 2.025e39]. This is strictly
        // less than 2^256 (which is about 10e77).

        // oneMinusSpreadBasisPoints i.e.,(1 - SpreadLow) should be divided by 1e2 to get product at 1e18 scale
        temp1 = mulExp(
            temp1,
            Exp({mantissa: oneMinusSpreadBasisPoints.mantissa / hundred})
        );

        // And then divide down by the spread's denominator (basis points divisor)
        // as well as by blocks per year.
        Exp memory supplyRate = divScalar(temp1, blocksPerYear); // basis points * blocks per year
        // divScalar only fails when divisor is zero. This is clearly not the case.

        // Note: supplyRate.mantissa is the rate scaled 1e20 ex., 23%
        // Note: we then divide by 1e2 to scale it down to the expected 1e18 scale, which matches the expected result ex., 0.2300
        return (true, supplyRate.mantissa / hundred);
    }

    /**
     * @notice Gets the current borrow interest rate based on the given asset, total cash and total borrows
     * @dev The return value should be scaled by 1e18, thus a return value of
     *      `(true, 1000000000000)` implies an interest rate of 0.000001 or 0.0001% *per block*.
     * @param asset The asset to get the interest rate of
     * @param cash The total cash of the asset in the market
     * @param borrows The total borrows of the asset in the market
     * @return Success or failure and the borrow interest rate per block scaled by 1e18
     */
    function getBorrowRate(
        address asset,
        uint256 cash,
        uint256 borrows
    ) public view returns (bool, uint256) {
        asset; // pragma ignore unused argument

        (
            bool success,
            ,
            Exp memory annualBorrowRate
        ) = getUtilizationAndAnnualBorrowRate(cash, borrows);
        if (!success) {
            return (false, 0);
        }

        // And then divide down by blocks per year.
        Exp memory borrowRate = divScalar(
            annualBorrowRate,
            blocksPerYear
        ); // basis points * blocks per year
        // divScalar only fails when divisor is zero. This is clearly not the case.

        // Note: borrowRate.mantissa is the rate scaled 1e20 ex., 23%
        // Note: we then divide by 1e2 to scale it down to the expected 1e18 scale, which matches the expected result ex., 0.2300
        return (true, borrowRate.mantissa / hundred);
    }
}

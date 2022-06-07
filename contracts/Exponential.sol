// Cloned from https://github.com/compound-finance/compound-money-market/blob/master/contracts/Exponential.sol -> Commit id: 241541a
// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./CarefulMath.sol";
import {Error} from "./ErrorReporter.sol";

contract Exponential is CarefulMath{
    // Per https://solidity.readthedocs.io/en/latest/contracts.html#constant-state-variables
    // the optimizer MAY replace the expression 10**18 with its calculated value.
    uint256 constant expScale = 10**18;
    
    struct Exp {
        uint256 mantissa;
    }
    /**
     * @dev Creates an exponential from numerator and denominator values.
     *      Note: Returns an error if (`num` * 10e18) > MAX_INT,
     *            or if `denom` is zero.
     */

    function getExp(uint256 num, uint256 denom)
        internal
        pure
        returns (Exp memory)
    {
        (bool success, uint256 scaledNumerator) = mul(num, expScale);
        require(success, Error.INTEGER_OVERFLOW);

        (bool success1, uint256 rational) = div(scaledNumerator, denom);
        require(success1, Error.DIVISION_BY_ZERO);

        return (Exp({mantissa: rational}));
    }


    /**
     * @dev Adds two exponentials, returning a new exponential.
     */
    
    function addExp(Exp memory a, Exp memory b)
        internal
        pure
        returns (Exp memory)
    {
        (bool success, uint256 result) = add(a.mantissa, b.mantissa);
        require(success, Error.INTEGER_OVERFLOW);

        return (Exp({mantissa: result}));
    }
    /**
     * @dev Subtracts two exponentials, returning a new exponential.
     */
    function subExp(Exp memory a, Exp memory b)
        internal
        pure
        returns (Exp memory)
    {
        (bool success, uint256 result) = sub(a.mantissa, b.mantissa);
        require(success, Error.INTEGER_UNDERFLOW);

        return (Exp({mantissa: result}));
    }

    /**
     * @dev Multiply an Exp by a scalar, returning a new Exp.
     */
    function mulScalar(Exp memory a, uint256 scalar)
        internal
        pure
        returns (Exp memory)
    {
        (bool success, uint256 scaledMantissa) = mul(a.mantissa, scalar);
        require(success, Error.INTEGER_OVERFLOW);

        return (Exp({mantissa: scaledMantissa}));
    }

    /**
     * @dev Divide an Exp by a scalar, returning a new Exp.
     */
    function divScalar(Exp memory a, uint256 scalar)
        internal
        pure
        returns (Exp memory)
    {
        (bool success, uint256 descaledMantissa) = div(a.mantissa, scalar);
        require(success, Error.DIVISION_BY_ZERO);

        return (Exp({mantissa: descaledMantissa}));
    }

    /**
     * @dev Divide a scalar by an Exp, returning a new Exp.
     */
    function divScalarByExp(uint256 scalar, Exp memory divisor)
        internal
        pure
        returns (Exp memory)
    {
        /*
            We are doing this as:
            getExp(mul(expScale, scalar), divisor.mantissa)
            How it works:
            Exp = a / b;
            Scalar = s;
            `s / (a / b)` = `b * s / a` and since for an Exp `a = mantissa, b = expScale`
        */
        (bool success, uint256 numerator) = mul(expScale, scalar);
        require(success, Error.INTEGER_OVERFLOW);

        return getExp(numerator, divisor.mantissa);
    }
    /**
     * @dev Multiplies two exponentials, returning a new exponential.
     */

    function mulExp(Exp memory a, Exp memory b)
        internal
        pure
        returns (Exp memory)
    {
        (bool success, uint256 doubleScaledProduct) = mul(a.mantissa, b.mantissa);
        require(success, Error.INTEGER_OVERFLOW);

        // We add half the scale before dividing so that we get rounding instead of truncation.
        //  See "Listing 6" and text above it at https://accu.org/index.php/journals/1717
        // Without this change, a result like 6.6...e-19 will be truncated to 0 instead of being rounded to 1e-18.
        (bool success1, uint256 doubleScaledProductWithHalfScale) = add(
            (expScale / 2),
            doubleScaledProduct
        );
        require(success1, Error.INTEGER_OVERFLOW);

        (bool success2, uint256 product) = div(
            doubleScaledProductWithHalfScale,
            expScale
        );
        // The only error `div` can return is Error.DIVISION_BY_ZERO but we control `expScale` and it is not zero.
        assert(success2 == true);

        return (Exp({mantissa: product}));
    }


   /**
     * @dev Divides two exponentials, returning a new exponential.
     *     (a/scale) / (b/scale) = (a/scale) * (scale/b) = a/b,
     *  which we can scale as an Exp by calling getExp(a.mantissa, b.mantissa)
     */
    function divExp(Exp memory a, Exp memory b)
        internal
        pure
        returns (Exp memory)
    {
        return getExp(a.mantissa, b.mantissa);
    }

    /**
     * @dev Truncates the given exp to a whole number value.
     *      For example, truncate(Exp{mantissa: 15 * (10**18)}) = 15
     */
    function truncate(Exp memory exp) internal pure returns (uint256) {
        // Note: We are not using careful math here as we're performing a division that cannot fail
        return exp.mantissa / expScale;
    }

    /**
     * @dev Checks if first Exp is less than second Exp.
     */
    function lessThanExp(Exp memory left, Exp memory right)
        internal
        pure
        returns (bool)
    {
        return left.mantissa < right.mantissa;
    }

    /**
     * @dev Checks if left Exp <= right Exp.
     */
    function lessThanOrEqualExp(Exp memory left, Exp memory right)
        internal
        pure
        returns (bool)
    {
        return left.mantissa <= right.mantissa;
    }

    /**
     * @dev Checks if first Exp is greater than second Exp.
     */
    function greaterThanExp(Exp memory left, Exp memory right)
        internal
        pure
        returns (bool)
    {
        return left.mantissa > right.mantissa;
    }

    /**
     * @dev returns true if Exp is exactly zero
     */
    function isZeroExp(Exp memory value) internal pure returns (bool) {
        return value.mantissa == 0;
    }
}


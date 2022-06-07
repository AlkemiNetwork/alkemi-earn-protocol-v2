// SPDX-License-Identifier: MIT
// Cloned from https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/utils/math/SafeMath.sol -> Commit id: 24a0bc2
// and added custom functions related to Alkemi

pragma solidity 0.8.11;

/**
 * @title Careful Math
 * @notice Derived from OpenZeppelin's SafeMath library
 *         https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/utils/math/SafeMath.sol
 */
contract CarefulMath {
    
     /**
     * @dev Returns the multiplication of two unsigned integers, with an overflow flag.
     */
    function mul(uint256 a, uint256 b) internal pure returns (bool, uint256) {
        unchecked {
            // Gas optimization: this is cheaper than requiring 'a' not being zero, but the
            // benefit is lost if 'b' is also tested.
            // See: https://github.com/OpenZeppelin/openzeppelin-contracts/pull/522
            if (a == 0) return (true, 0);
            uint256 c = a * b;
            if (c / a != b) return (false, 0);
            return (true, c);
        }
    }

   /**
     * @dev Returns the division of two unsigned integers, with a division by zero flag.
     */
    function div(uint256 a, uint256 b) internal pure returns (bool, uint256) {
        unchecked {
            if (b == 0) return (false, 0);
            return (true, a / b);
        }
    }

   /**
     * @dev Returns the substraction of two unsigned integers, with an overflow flag.
     */
    function sub(uint256 a, uint256 b) internal pure returns (bool, uint256) {
        unchecked {
            if (b > a) return (false, 0);
            return (true, a - b);
        }
    }

    /**
     * @dev Returns the addition of two unsigned integers, with an overflow flag.
     */
    function add(uint256 a, uint256 b) internal pure returns (bool, uint256) {
        unchecked {
            uint256 c = a + b;
            if (c < a) return (false, 0);
            return (true, c);
        }
    }

    /**
     * @dev add a and b and then subtract c
     */
    function addThenSub(
        uint256 a,
        uint256 b,
        uint256 c
    ) internal pure returns (bool, uint256) {
        (bool success, uint256 sum) = add(a, b);

        if (!success) {
            return (success, 0);
        }

        return sub(sum, c);
    }

            /**
     * @dev Simple function to calculate min between two numbers.
     */
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a < b) {
            return a;
        } else {
            return b;
        }
    }
}
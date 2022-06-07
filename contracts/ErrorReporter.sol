// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

library Error{
    string constant NO_ERROR = '1';
    string constant UNAUTHORIZED = '2';
    string constant INTEGER_OVERFLOW = '3';
    string constant INTEGER_UNDERFLOW = '4';
    string constant DIVISION_BY_ZERO = '5';
    string constant TOKEN_INSUFFICIENT_ALLOWANCE = '6';
    string constant TOKEN_INSUFFICIENT_BALANCE = '7';
    string constant TOKEN_INSUFFICIENT_CASH = '8';
    string constant TOKEN_TRANSFER_FAILED = '9';
    string constant MARKET_NOT_SUPPORTED = "10";
    string constant SUPPLY_RATE_CALCULATION_FAILED = "11";
    string constant BORROW_RATE_CALCULATION_FAILED = "12";
    string constant TRANSFER_OUT_FAILED = "13";
    string constant INSUFFICIENT_LIQUIDITY = "14";
    string constant INSUFFICIENT_BALANCE = "15";
    string constant INVALID_COLLATERAL_RATIO = "16";
    string constant MISSING_ASSET_PRICE = "17";
    string constant EQUITY_INSUFFICIENT_BALANCE = "18";
    string constant ASSET_NOT_PRICED = "19";
    string constant INVALID_LIQUIDATION_DISCOUNT = "20";
    string constant ZERO_ORACLE_ADDRESS = "21";
    string constant CONTRACT_PAUSED = "22";
    string constant LIQUIDATOR_CHECK_FAILED = "23";
    string constant WETH_ADDRESS_NOT_SET_ERROR = "24";
    string constant ETHER_AMOUNT_MISMATCH_ERROR = "25";
    string constant ADDRESS_CANNOT_BE_0X00 = "26";
    string constant EXCEEDED_MAX_MARKETS_ALLOWED = "27";
    string constant NEW_TOTAL_BALANCE_CALCULATION_FAILED = "28";
    string constant NEW_TOTAL_SUPPLY_CALCULATION_FAILED = "29";
    string constant ACCUMULATED_BORROW_BALANCE_CALCULATION_FAILED = "30";
    string constant SUPPLY_BALANCE_CALCULATION_FAILED_BCA = "31";
    string constant SUPPLY_BALANCE_CALCULATION_FAILED_LCA = "32";
    string constant INVALID_COMBINED_RISK_PARAMETERS = "33";
    string constant NEW_TOTAL_CASH_CALCULATION_FAILED = "34";
    string constant NEW_TOTAL_BORROW_CALCULATION_FAILED = "35";
    string constant ACCUMULATED_BALANCE_CALCULATION_FAILED_BCA = "36";
    string constant ACCUMULATED_BALANCE_CALCULATION_FAILED_LCA = "37";
    string constant INVALID_CLOSE_AMOUNT_REQUESTED = "38";
    string constant LD_EXCEEDED_MAX_DISCOUNT = "39";
    string constant INTERNAL_EXCEPTION = "40";
    string constant INVALID_ORG_FEE_CLOSE_FACTOR_MANTISSA = "41";
    string constant NOT_A_KYC_CUSTOMER = "42";
    string constant NOT_A_KYC_ADMIN = "43";
    string constant NEW_TOTAL_BALANCE_CALCULATION_FAILED_BCA = "44";
    string constant NEW_TOTAL_BALANCE_CALCULATION_FAILED_LCA = "45";
    string constant ACCUMULATED_SUPPLY_BALANCE_CALCULATION_FAILED = "46";
    string constant MIN_RATE_GREATER_THAN_MAX_RATE = "47";
    string constant HEALTHLY_MINUR_GREATER_THAN_HEALTHLY_MAXUR ="48";
    string constant SPREAD_MID_IS_NEGATIVE = "49";
    string constant SPREAD_MAX_IS_NEGATIVE = "50";
    string constant SAME_ADDRESS = "51";
    string constant NEW_INDEX_EXCEEDS_224_BITS = "52";
    string constant BLOCK_NUMBER_EXCEEDS_32_BITS = "53";
}
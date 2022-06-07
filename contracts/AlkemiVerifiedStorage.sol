// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./InterestRateModel.sol";
import "./AlkemiWETH.sol";
import "./Exponential.sol";
import "./RewardControlInterface.sol";

contract AlkemiVerifiedStorage is Exponential{
    uint256 internal initialInterestIndex;
    uint256 internal defaultOriginationFee;
    uint256 internal defaultCollateralRatio;
    uint256 internal defaultLiquidationDiscount;
    // minimumCollateralRatioMantissa and maximumLiquidationDiscountMantissa cannot be declared as constants due to upgradeability
    // Values cannot be assigned directly as OpenZeppelin upgrades do not support the same
    // Values can only be assigned using initializer() below
    // However, there is no way to change the below values using any functions and hence they act as constants
    uint256 internal minimumCollateralRatioMantissa;
    uint256 internal maximumLiquidationDiscountMantissa;

    /**
     * @dev pending Administrator for this contract.
     */
    address public pendingAdmin;

    /**
     * @dev Administrator for this contract. Initially set in constructor, but can
     *      be changed by the admin itself.
     */
    address public admin;

    /**
     * @dev Account allowed to fetch chainlink oracle prices for this contract. Can be changed by the admin.
     */
    //ChainLink public priceOracle;

   
    /**
     * @dev Container for customer balance information written to storage.
     *
     *      struct Balance {
     *        principal = customer total balance with accrued interest after applying the customer's most recent balance-changing action
     *        interestIndex = Checkpoint for interest calculation after the customer's most recent balance-changing action
     *      }
     */
    struct Balance {
        uint256 principal;
        uint256 interestIndex;
    }

    /**
     * @dev 2-level map: customerAddress -> assetAddress -> balance for supplies
     */
    mapping(address => mapping(address => Balance)) internal supplyBalances;

    /**
     * @dev 2-level map: customerAddress -> assetAddress -> balance for borrows
     */
    mapping(address => mapping(address => Balance)) internal borrowBalances;

    /**
     * @dev Container for per-asset balance sheet and interest rate information written to storage, intended to be stored in a map where the asset address is the key
     *
     *      struct Market {
     *         isSupported = Whether this market is supported or not (not to be confused with the list of collateral assets)
     *         blockNumber = when the other values in this struct were calculated
     *         interestRateModel = Interest Rate model, which calculates supply interest rate and borrow interest rate based on Utilization, used for the asset
     *         totalSupply = total amount of this asset supplied (in asset wei)
     *         supplyRateMantissa = the per-block interest rate for supplies of asset as of blockNumber, scaled by 10e18
     *         supplyIndex = the interest index for supplies of asset as of blockNumber; initialized in _supportMarket
     *         totalBorrows = total amount of this asset borrowed (in asset wei)
     *         borrowRateMantissa = the per-block interest rate for borrows of asset as of blockNumber, scaled by 10e18
     *         borrowIndex = the interest index for borrows of asset as of blockNumber; initialized in _supportMarket
     *     }
     */
    struct Market {
        bool isSupported;
        uint256 blockNumber;
        InterestRateModel interestRateModel;
        uint256 totalSupply;
        uint256 supplyRateMantissa;
        uint256 supplyIndex;
        uint256 totalBorrows;
        uint256 borrowRateMantissa;
        uint256 borrowIndex;
        
    }

    /**
     * @dev Initiates the contract for supply and withdraw Ether and conversion to WETH
     */
    //AlkemiWETH public WETHContract;

    /**
     * @dev map: assetAddress -> Market
     */
    mapping(address => Market) public markets;

    /**
     * @dev The collateral ratio that borrows must maintain (e.g. 2 implies 2:1). This
     *      is initially set in the constructor, but can be changed by the admin.
     */
    Exp public collateralRatio;

    /**
     * @dev originationFee for new borrows.
     *
     */
    Exp public originationFee;

    /**
     * @dev liquidationDiscount for collateral when liquidating borrows
     *
     */
    Exp internal liquidationDiscount;

    /**
     * @dev flag for whether or not contract is paused
     *
     */
    bool public paused;

    /**
     * @dev Mapping to identify the list of KYC Admins
     */
    mapping(address => bool) internal KYCAdmins;
    /**
     * @dev Mapping to identify the list of customers with verified KYC
     */
    mapping(address => bool) public customersWithKYC;

    /**
     * @dev Mapping to identify the list of customers with Liquidator roles
     */
    mapping(address => bool) internal liquidators;

    /**
     * The `SupplyLocalVars` struct is used internally in the `supply` function.
     *
     * To avoid solidity limits on the number of local variables we:
     * 1. Use a struct to hold local computation localResults
     * 2. Re-use a single variable for Error returns. (This is required with 1 because variable binding to tuple localResults
     *    requires either both to be declared inline or both to be previously declared.
     * 3. Re-use a boolean error-like return variable.
     */
    struct ProtocolLocalVars {
        uint256 startingBalance;
        uint256 newSupplyIndex;
        uint256 userSupplyCurrent;
        uint256 userSupplyUpdated;
        uint256 newTotalSupply;
        uint256 currentCash;
        uint256 updatedCash;
        uint256 newSupplyRateMantissa;
        uint256 newBorrowIndex;
        uint256 newBorrowRateMantissa;
        uint256 withdrawAmount;
        uint256 withdrawCapacity;
        uint256 userBorrowCurrent;
        uint256 repayAmount;
        uint256 userBorrowUpdated;
        uint256 newTotalBorrows;
        uint256 borrowAmountWithFee;
        Exp accountLiquidity;
        Exp accountShortfall;
        Exp ethValueOfWithdrawal;
        Exp ethValueOfBorrowAmountWithFee;
    }

    // The `AccountValueLocalVars` struct is used internally in the `CalculateAccountValuesInternal` function.
    struct AccountValueLocalVars {
        address assetAddress;
        uint256 collateralMarketsLength;
        uint256 newSupplyIndex;
        uint256 userSupplyCurrent;
        uint256 newBorrowIndex;
        uint256 userBorrowCurrent;
        Exp borrowTotalValue;
        Exp sumBorrows;
        Exp supplyTotalValue;
        Exp sumSupplies;
    }

    // The `LiquidateLocalVars` struct is used internally in the `liquidateBorrow` function.
    struct LiquidateLocalVars {
        // we need these addresses in the struct for use with `emitLiquidationEvent` to avoid `CompilerError: Stack too deep, try removing local variables.`
        address targetAccount;
        address assetBorrow;
        address liquidator;
        address assetCollateral;
        // borrow index and supply index are global to the asset, not specific to the user
        uint256 newBorrowIndex_UnderwaterAsset;
        uint256 newSupplyIndex_UnderwaterAsset;
        uint256 newBorrowIndex_CollateralAsset;
        uint256 newSupplyIndex_CollateralAsset;
        // the target borrow's full balance with accumulated interest
        uint256 currentBorrowBalance_TargetUnderwaterAsset;
        // currentBorrowBalance_TargetUnderwaterAsset minus whatever gets repaid as part of the liquidation
        uint256 updatedBorrowBalance_TargetUnderwaterAsset;
        uint256 newTotalBorrows_ProtocolUnderwaterAsset;
        uint256 startingBorrowBalance_TargetUnderwaterAsset;
        uint256 startingSupplyBalance_TargetCollateralAsset;
        uint256 startingSupplyBalance_LiquidatorCollateralAsset;
        uint256 currentSupplyBalance_TargetCollateralAsset;
        uint256 updatedSupplyBalance_TargetCollateralAsset;
        // If liquidator already has a balance of collateralAsset, we will accumulate
        // interest on it before transferring seized collateral from the borrower.
        uint256 currentSupplyBalance_LiquidatorCollateralAsset;
        // This will be the liquidator's accumulated balance of collateral asset before the liquidation (if any)
        // plus the amount seized from the borrower.
        uint256 updatedSupplyBalance_LiquidatorCollateralAsset;
        uint256 newTotalSupply_ProtocolCollateralAsset;
        uint256 currentCash_ProtocolUnderwaterAsset;
        uint256 updatedCash_ProtocolUnderwaterAsset;
        // cash does not change for collateral asset

        uint256 newSupplyRateMantissa_ProtocolUnderwaterAsset;
        uint256 newBorrowRateMantissa_ProtocolUnderwaterAsset;
        // Why no variables for the interest rates for the collateral asset?
        // We don't need to calculate new rates for the collateral asset since neither cash nor borrows change

        uint256 discountedRepayToEvenAmount;
        //[supplyCurrent / (1 + liquidationDiscount)] * (Oracle price for the collateral / Oracle price for the borrow) (discountedBorrowDenominatedCollateral)
        uint256 discountedBorrowDenominatedCollateral;
        uint256 maxCloseableBorrowAmount_TargetUnderwaterAsset;
        uint256 closeBorrowAmount_TargetUnderwaterAsset;
        uint256 seizeSupplyAmount_TargetCollateralAsset;
        uint256 reimburseAmount;
        Exp collateralPrice;
        Exp underwaterAssetPrice;
    }

    /**
     * @dev 2-level map: customerAddress -> assetAddress -> originationFeeBalance for borrows
     */
    mapping(address => mapping(address => uint256))
        internal originationFeeBalance;

    /**
     * @dev Reward Control Contract address
     */
    RewardControlInterface public rewardControl;

    /**
     * @notice Multiplier used to calculate the maximum repayAmount when liquidating a borrow
     */
    uint256 public closeFactorMantissa;

    /// @dev _guardCounter and nonReentrant modifier extracted from Open Zeppelin's reEntrancyGuard
    /// @dev counter to allow mutex lock with only one SSTORE operation
    uint256 internal _guardCounter;
}
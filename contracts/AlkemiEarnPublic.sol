// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./AlkemiPublicInterface.sol";
import "./AlkemiPublicStorage.sol";
import "./InterestRateModel.sol";
import "./SafeToken.sol";
import "./AlkemiWETH.sol";
import "./ProtocolUtils.sol";
import "./RewardControlInterface.sol";

contract AlkemiEarnPublic is 
SafeToken, 
ProtocolUtils, 
AlkemiPublicStorage, 
AlkemiPublicInterface {
    
    bool private initializationDone; // To make sure initializer is called only once
    /**
     * @dev wethAddress to hold the WETH token contract address
     * set using setWethAddress function
     */
    address public wethAddress;

    /**
     * @notice `AlkemiEarnPublic` is the core contract
     * @notice This contract uses Openzeppelin Upgrades plugin to make use of the upgradeability functionality using proxies
     * @notice Hence this contract has an 'initializer' in place of a 'constructor'
     * @notice Make sure to add new global variables only at the bottom of all the existing global variables i.e., line #344
     * @notice Also make sure to do extensive testing while modifying any structs and enums during an upgrade
     */
    function initializer() public {
        if (initializationDone == false) {
            initializationDone = true;
            admin = msg.sender;
            initialInterestIndex = 10**18;
            defaultOriginationFee = (10**15); // default is 0.1%
            defaultCollateralRatio = 125 * (10**16); // default is 125% or 1.25
            defaultLiquidationDiscount = (10**17); // default is 10% or 0.1
            minimumCollateralRatioMantissa = 11 * (10**17); // 1.1
            maximumLiquidationDiscountMantissa = (10**17); // 0.1
            collateralRatio = Exp({mantissa: defaultCollateralRatio});
            originationFee = Exp({mantissa: defaultOriginationFee});
            liquidationDiscount = Exp({mantissa: defaultLiquidationDiscount});
            _guardCounter = 1;
            // oracle must be configured via _adminFunctions
        }
    }

    /**
     * @notice Do not pay directly into AlkemiEarnPublic, please use `supply`.
     */
    fallback() external { revert(); }
    /**
     * @dev Prevents a contract from calling itself, directly or indirectly.
     * If you mark a function `nonReentrant`, you should also
     * mark it `external`. Calling one `nonReentrant` function from
     * another is not supported. Instead, you can implement a
     * `private` function doing the actual work, and an `external`
     * wrapper marked as `nonReentrant`.
     */
    modifier nonReentrant() {
        _guardCounter += 1;
        uint256 localCounter = _guardCounter;
        _;
        require(localCounter == _guardCounter);
    }

    /**
     * @dev Throws if contract is paused.
     */
    modifier isPaused() {
        require(!paused, Error.CONTRACT_PAUSED);
        _;
    }
    
    /**
     * @dev Throws if market is not supported.
     */
    modifier isMarketSuppported(address asset) {
        require(markets[asset].isSupported, Error.MARKET_NOT_SUPPORTED);
        _;
    }

    /**
     * @dev Throws if called by any account other than the admin.
     */
    modifier onlyOwner() {
        // Check caller = admin
        require(msg.sender == admin, Error.UNAUTHORIZED);
        _;
    }

    /**
     * @dev emitted when a supply is received
     *      Note: newBalance - amount - startingBalance = interest accumulated since last change
     */
    event SupplyReceived(
        address account,
        address asset,
        uint256 amount,
        uint256 startingBalance,
        uint256 newBalance
    );

    /**
     * @dev emitted when a origination fee supply is received as admin
     *      Note: newBalance - amount - startingBalance = interest accumulated since last change
     */
    event SupplyOrgFeeAsAdmin(
        address account,
        address asset,
        uint256 amount,
        uint256 startingBalance,
        uint256 newBalance
    );
    /**
     * @dev emitted when a supply is withdrawn
     *      Note: startingBalance - amount - startingBalance = interest accumulated since last change
     */
    event SupplyWithdrawn(
        address account,
        address asset,
        uint256 amount,
        uint256 startingBalance,
        uint256 newBalance
    );

    /**
     * @dev emitted when a new borrow is taken
     *      Note: newBalance - borrowAmountWithFee - startingBalance = interest accumulated since last change
     */
    event BorrowTaken(
        address account,
        address asset,
        uint256 amount,
        uint256 startingBalance,
        uint256 borrowAmountWithFee,
        uint256 newBalance
    );

    /**
     * @dev emitted when a borrow is repaid
     *      Note: newBalance - amount - startingBalance = interest accumulated since last change
     */
    event BorrowRepaid(
        address account,
        address asset,
        uint256 amount,
        uint256 startingBalance,
        uint256 newBalance
    );

    /**
     * @dev emitted when a borrow is liquidated
     *      targetAccount = user whose borrow was liquidated
     *      assetBorrow = asset borrowed
     *      borrowBalanceBefore = borrowBalance as most recently stored before the liquidation
     *      borrowBalanceAccumulated = borroBalanceBefore + accumulated interest as of immediately prior to the liquidation
     *      amountRepaid = amount of borrow repaid
     *      liquidator = account requesting the liquidation
     *      assetCollateral = asset taken from targetUser and given to liquidator in exchange for liquidated loan
     *      borrowBalanceAfter = new stored borrow balance (should equal borrowBalanceAccumulated - amountRepaid)
     *      collateralBalanceBefore = collateral balance as most recently stored before the liquidation
     *      collateralBalanceAccumulated = collateralBalanceBefore + accumulated interest as of immediately prior to the liquidation
     *      amountSeized = amount of collateral seized by liquidator
     *      collateralBalanceAfter = new stored collateral balance (should equal collateralBalanceAccumulated - amountSeized)
     *      assetBorrow and assetCollateral are not indexed as indexed addresses in an event is limited to 3
     */
    event BorrowLiquidated(
        address targetAccount,
        address assetBorrow,
        uint256 borrowBalanceAccumulated,
        uint256 amountRepaid,
        address liquidator,
        address assetCollateral,
        uint256 amountSeized
    );

    /**
     * @dev emitted when pendingAdmin is accepted, which means admin is updated
     */
    event NewAdmin(address oldAdmin, address newAdmin);

    // /**
    //  * @dev emitted when risk parameters are changed by admin
    //  */
    // event NewRiskParameters(
    //     uint256 oldCollateralRatioMantissa,
    //     uint256 newCollateralRatioMantissa,
    //     uint256 oldLiquidationDiscountMantissa,
    //     uint256 newLiquidationDiscountMantissa
    // );

    // /**
    //  * @dev emitted when origination fee is changed by admin
    //  */
    // event NewOriginationFee(
    //     uint256 oldOriginationFeeMantissa,
    //     uint256 newOriginationFeeMantissa
    // );

    // /**
    //  * @dev emitted when market has new interest rate model set
    //  */
    // event SetMarketInterestRateModel(
    //     address asset,
    //     address interestRateModel
    // );

    // /**
    //  * @dev emitted when admin withdraws equity
    //  * Note that `equityAvailableBefore` indicates equity before `amount` was removed.
    //  */
    event EquityWithdrawn(
        address asset,
        uint256 equityAvailableBefore,
        uint256 amount,
        address owner
    );

    /**
     * @dev Adds a given asset to the list of collateral markets. This operation is impossible to reverse.
     *      Note: this will not add the asset if it already exists.
     */
    function addCollateralMarket(address asset) internal {
        for (uint256 i = 0; i < collateralMarkets.length; i++) {
            if (collateralMarkets[i] == asset) {
                return;
            }
        }

        collateralMarkets.push(asset);
    }

    /**
     * @notice return the number of elements in `collateralMarkets`
     * @dev you can then externally call `collateralMarkets(uint)` to pull each market address
     * @return the length of `collateralMarkets`
     */
    function getCollateralMarketsLength() external view returns (uint256) {
        return collateralMarkets.length;
    }


    /**
     * @notice return the total supply for a market
     */
    function getMarketTotalSupplyPublic(address market) external view returns(uint256) { 
        return markets[market].totalSupply;
    }

    /**
     * @notice return the total borrow for a market
     */
    function getMarketTotalBorrowPublic(address market) external view returns(uint256) { 
        return markets[market].totalBorrows;
    }

    /**
     * @notice Reads scaled price of specified asset from the price oracle
     * @dev Reads scaled price of specified asset from the price oracle.
     *      The plural name is to match a previous storage mapping that this function replaced.
     * @param asset Asset whose price should be retrieved
     * @return 0 on an error or missing price, the price scaled by 1e18 otherwise
     */
    function assetPrices(address asset) external view returns (uint256) {
        Exp memory result = fetchAssetPrice(asset);

        return result.mantissa;
    }

    /**
     * @dev Gets the price for the amount specified of the given asset multiplied by the current
     *      collateral ratio (i.e., assetAmountWei * collateralRatio * oraclePrice = totalValueInEth).
     *      We will group this as `(oraclePrice * collateralRatio) * assetAmountWei`
     * @return Return value is expressed in a magnified scale per token decimals
     */
    function getPriceForAssetAmountMulCollatRatio(
        address asset,
        uint256 assetAmount
    ) internal view returns (Exp memory) {

        Exp memory assetPrice;
        Exp memory scaledPrice;
        assetPrice = fetchAssetPrice(asset);

        require(!isZeroExp(assetPrice), Error.MISSING_ASSET_PRICE);

        // Now, multiply the assetValue by the collateral ratio
        scaledPrice = mulExp(collateralRatio, assetPrice);

        // Get the price for the given asset amount
        return mulScalar(scaledPrice, assetAmount);
    }

    /**
     * @dev Calculates the origination fee added to a given borrowAmount
     *      This is simply `(1 + originationFee) * borrowAmount`
     * @return Return value is expressed in 1e18 scale
     */
    function calculateBorrowAmountWithFee(uint256 borrowAmount)
        internal
        view
        returns (uint256)
    {
        // When origination fee is zero, the amount with fee is simply equal to the amount
        if (isZeroExp(originationFee)) {
            return (borrowAmount);
        }

        Exp memory originationFeeFactor = addExp(
            originationFee,
            Exp({mantissa: expScale})
        );

        Exp memory borrowAmountWithFee = mulScalar(
            originationFeeFactor,
            borrowAmount
        );

        return (truncate(borrowAmountWithFee));
    }

    /**
     * @notice Admin Functions. The newPendingAdmin must call `_acceptAdmin` to finalize the transfer.
     * @dev Admin function to begin change of admin. The newPendingAdmin must call `_acceptAdmin` to finalize the transfer.
     * @param newPendingAdmin New pending admin
     * @param newOracle New oracle address
     * @param requestedState value to assign to `paused`
     * @param originationFeeMantissa rational collateral ratio, scaled by 1e18.
     * @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
     */
    function _adminFunctions(
        address newPendingAdmin,
        address payable newOracle,
        bool requestedState,
        uint256 originationFeeMantissa,
        uint256 newCloseFactorMantissa
    ) public onlyOwner returns (bool) {

        // newPendingAdmin can be 0x00, hence not checked
        require(newOracle != address(0), Error.ADDRESS_CANNOT_BE_0X00);
        require(
            originationFeeMantissa < 10**18 && newCloseFactorMantissa < 10**18,
            Error.INVALID_ORG_FEE_CLOSE_FACTOR_MANTISSA
        );

        // Store pendingAdmin = newPendingAdmin
        pendingAdmin = newPendingAdmin;

        // Verify contract at newOracle address supports assetPrices call.
        // This will revert if it doesn't.
        // ChainLink priceOracleTemp = ChainLink(newOracle);
        // priceOracleTemp.getAssetPrice(address(0));

        // Initialize the Chainlink contract in priceOracle
        priceOracle = ChainLinkInterface(newOracle);

        paused = requestedState;

        // Save current value so we can emit it in log.
       // Exp memory oldOriginationFee = originationFee;

        originationFee = Exp({mantissa: originationFeeMantissa});
        // emit NewOriginationFee(
        //     oldOriginationFee.mantissa,
        //     originationFeeMantissa
        // );

        closeFactorMantissa = newCloseFactorMantissa;

        return true;
    }

    /**
     * @notice Accepts transfer of admin rights. msg.sender must be pendingAdmin
     * @dev Admin function for pending admin to accept role and update admin
     */
    function _acceptAdmin() public {
        // Check caller = pendingAdmin
        // msg.sender can't be zero
        require(msg.sender == pendingAdmin, Error.UNAUTHORIZED);

        // Save current value for inclusion in log
        address oldAdmin = admin;
        // Store admin = pendingAdmin
        admin = pendingAdmin;
        // Clear the pending value
        pendingAdmin = address(0);

        emit NewAdmin(oldAdmin, msg.sender);
    }

    /**
     * @notice returns the liquidity for given account.
     *         a positive result indicates ability to borrow, whereas
     *         a negative result indicates a shortfall which may be liquidated
     * @dev returns account liquidity in terms of eth-wei value, scaled by 1e18 and truncated when the value is 0 or when the last few decimals are 0
     *      note: this includes interest trued up on all balances
     * @param account the account to examine
     * @return signed integer in terms of eth-wei (negative indicates a shortfall)
     */
    function getAccountLiquidity(address account) external view returns (int256) {
        (
            Exp memory accountLiquidity,
            Exp memory accountShortfall
        ) = calculateAccountLiquidity(account);

        if (isZeroExp(accountLiquidity)) {
            return -1 * int256(truncate(accountShortfall));
        } else {
            return int256(truncate(accountLiquidity));
        }
    }

    /**
     * @notice return supply balance with any accumulated interest for `asset` belonging to `account`
     * @dev returns supply balance with any accumulated interest for `asset` belonging to `account`
     * @param account the account to examine
     * @param asset the market asset whose supply balance belonging to `account` should be checked
     * @return uint supply balance on success, throws on failed assertion otherwise
     */
    function getSupplyBalance(address account, address asset)
        external
        view
        returns (uint256)
    {
        uint256 newSupplyIndex;
        uint256 userSupplyCurrent;
        bool success;

        Market storage market = markets[asset];
        Balance storage supplyBalance = supplyBalances[account][asset];

        // Calculate the newSupplyIndex, needed to calculate user's supplyCurrent
        newSupplyIndex = calculateInterestIndex(
            market.supplyIndex,
            market.supplyRateMantissa,
            market.blockNumber,
            block.number
        );

        // Use newSupplyIndex and stored principal to calculate the accumulated balance
        (success,userSupplyCurrent) = calculateBalance(
            supplyBalance.principal,
            supplyBalance.interestIndex,
            newSupplyIndex
        );
        revertIfError(success);

        return userSupplyCurrent;
    }

    /**
     * @notice return borrow balance with any accumulated interest for `asset` belonging to `account`
     * @dev returns borrow balance with any accumulated interest for `asset` belonging to `account`
     * @param account the account to examine
     * @param asset the market asset whose borrow balance belonging to `account` should be checked
     * @return uint borrow balance on success, throws on failed assertion otherwise
     */
    function getBorrowBalance(address account, address asset)
        external
        view
        returns (uint256)
    {
        uint256 newBorrowIndex;
        uint256 userBorrowCurrent;
        bool success;

        Market storage market = markets[asset];
        Balance storage borrowBalance = borrowBalances[account][asset];

        // Calculate the newBorrowIndex, needed to calculate user's borrowCurrent
        newBorrowIndex = calculateInterestIndex(
            market.borrowIndex,
            market.borrowRateMantissa,
            market.blockNumber,
            block.number
        );

        // Use newBorrowIndex and stored principal to calculate the accumulated balance
        (success,userBorrowCurrent) = calculateBalance(
            borrowBalance.principal,
            borrowBalance.interestIndex,
            newBorrowIndex
        );
        revertIfError(success);

        return userBorrowCurrent;
    }

    /**
     * @notice Supports a given market (asset) for use
     * @dev Admin function to add support for a market
     * @param asset Asset to support; MUST already have a non-zero price set
     * @param interestRateModel InterestRateModel to use for the asset
     * @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
     */
    function _supportMarket(address asset, InterestRateModel interestRateModel)
        public
        onlyOwner
        returns (bool)
    {
        require(address(interestRateModel) != address(0), Error.ADDRESS_CANNOT_BE_0X00);
        // Hard cap on the maximum number of markets allowed
        require(
            collateralMarkets.length < 16, // 16 = MAXIMUM_NUMBER_OF_MARKETS_ALLOWED
            Error.EXCEEDED_MAX_MARKETS_ALLOWED
        );

        Exp memory assetPrice = fetchAssetPrice(asset);

        require(!isZeroExp(assetPrice), Error.ASSET_NOT_PRICED); 

        // Set the interest rate model to `modelAddress`
        markets[asset].interestRateModel = interestRateModel;

        // Append asset to collateralAssets if not set
        addCollateralMarket(asset);

        // Set market isSupported to true
        markets[asset].isSupported = true;

        // Default supply and borrow index to 1e18
        if (markets[asset].supplyIndex == 0) {
            markets[asset].supplyIndex = initialInterestIndex;
        }

        if (markets[asset].borrowIndex == 0) {
            markets[asset].borrowIndex = initialInterestIndex;
        }

        // emit SupportedMarket(asset, interestRateModel);

        return true;
    }

    /**
     * @notice Suspends a given *supported* market (asset) from use.
     *         Assets in this state do count for collateral, but users may only withdraw, payBorrow,
     *         and liquidate the asset. The liquidate function no longer checks collateralization.
     * @dev Admin function to suspend a market
     * @param asset Asset to suspend
     * @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
     */
    function _suspendMarket(address asset) public onlyOwner returns (bool) {

        // If the market is not configured at all, we don't want to add any configuration for it.
        // If we find !markets[asset].isSupported then either the market is not configured at all, or it
        // has already been marked as unsupported. We can just return without doing anything.
        // Caller is responsible for knowing the difference between not-configured and already unsupported.
        if (!markets[asset].isSupported) {
            return true;
        }

        // If we get here, we know market is configured and is supported, so set isSupported to false
        markets[asset].isSupported = false;

        return true;
    }

    /**
     * @notice Sets the risk parameters: collateral ratio and liquidation discount
     * @dev Owner function to set the risk parameters
     * @param collateralRatioMantissa rational collateral ratio, scaled by 1e18. The de-scaled value must be >= 1.1
     * @param liquidationDiscountMantissa rational liquidation discount, scaled by 1e18. The de-scaled value must be <= 0.1 and must be less than (descaled collateral ratio minus 1)
     * @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
     */
    function _setRiskParameters(
        uint256 collateralRatioMantissa,
        uint256 liquidationDiscountMantissa
    ) public onlyOwner returns (bool) {

        // Input validations
        require(
            collateralRatioMantissa >= minimumCollateralRatioMantissa &&
                liquidationDiscountMantissa <=
                maximumLiquidationDiscountMantissa,
                Error.LD_EXCEEDED_MAX_DISCOUNT
        );

        Exp memory newCollateralRatio = Exp({
            mantissa: collateralRatioMantissa
        });
        Exp memory newLiquidationDiscount = Exp({
            mantissa: liquidationDiscountMantissa
        });
        Exp memory minimumCollateralRatio = Exp({
            mantissa: minimumCollateralRatioMantissa
        });
        Exp memory maximumLiquidationDiscount = Exp({
            mantissa: maximumLiquidationDiscountMantissa
        });

        Exp memory newLiquidationDiscountPlusOne;

        // Make sure new collateral ratio value is not below minimum value
        require(!lessThanExp(newCollateralRatio, minimumCollateralRatio), 
        Error.INVALID_COLLATERAL_RATIO);

        // Make sure new liquidation discount does not exceed the maximum value, but reverse operands so we can use the
        // existing `lessThanExp` function rather than adding a `greaterThan` function to Exponential.
        require(!lessThanExp(maximumLiquidationDiscount, newLiquidationDiscount), 
        Error.INVALID_LIQUIDATION_DISCOUNT);

        // C = L+1 is not allowed because it would cause division by zero error in `calculateDiscountedRepayToEvenAmount`
        // C < L+1 is not allowed because it would cause integer underflow error in `calculateDiscountedRepayToEvenAmount`
        newLiquidationDiscountPlusOne = addExp(
            newLiquidationDiscount,
            Exp({mantissa: expScale})
        );

        require(!lessThanOrEqualExp(newCollateralRatio,newLiquidationDiscountPlusOne), 
        Error.INVALID_COMBINED_RISK_PARAMETERS);

        // Save current values so we can emit them in log.
        //Exp memory oldCollateralRatio = collateralRatio;
        //Exp memory oldLiquidationDiscount = liquidationDiscount;

        // Store new values
        collateralRatio = newCollateralRatio;
        liquidationDiscount = newLiquidationDiscount;

        // emit NewRiskParameters(
        //     oldCollateralRatio.mantissa,
        //     collateralRatioMantissa,
        //     oldLiquidationDiscount.mantissa,
        //     liquidationDiscountMantissa
        // );

        return true;
    }

    /**
     * @notice Sets the interest rate model for a given market
     * @dev Admin function to set interest rate model
     * @param asset Asset to support
     * @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
     */
    function _setMarketInterestRateModel(
        address asset,
        InterestRateModel interestRateModel
    ) public onlyOwner returns (bool) {

        require(address(interestRateModel) != address(0), Error.ADDRESS_CANNOT_BE_0X00);

        // Set the interest rate model to `modelAddress`
        markets[asset].interestRateModel = interestRateModel;

        // emit SetMarketInterestRateModel(asset, interestRateModel);

        return true;
    }

    /**
     * @notice withdraws `amount` of `asset` from equity for asset, as long as `amount` <= equity. Equity = cash + borrows - supply
     * @dev withdraws `amount` of `asset` from equity  for asset, enforcing amount <= cash + borrows - supply
     * @param asset asset whose equity should be withdrawn
     * @param amount amount of equity to withdraw; must not exceed equity available
     * 
     */
    function _withdrawEquity(address asset, uint256 amount)
        public
        onlyOwner
    {
        bool success;
        uint256 equity;
        // Check that amount is less than cash (from ERC-20 of self) plus borrows minus supply.
        uint256 cash = getCash(asset);
        // Check that amount is less than cash (from ERC-20 of self) plus borrows minus supply.
        // Get supply and borrows with interest accrued till the latest block
        (
            uint256 supplyWithInterest,
            uint256 borrowWithInterest
        ) = getMarketBalances(asset);
        (success,equity) = addThenSub(
            cash,
            borrowWithInterest,
            supplyWithInterest
        );

        require(amount < equity, Error.EQUITY_INSUFFICIENT_BALANCE); 
        /////////////////////////
        // EFFECTS & INTERACTIONS
        // (No safe failures beyond this point)

        if (asset != wethAddress) {
            // Withdrawal should happen as Ether directly
            // We ERC-20 transfer the asset out of the protocol to the admin
            doTransferOut(asset, admin, amount);
        } else {
            withdrawEther(admin, amount); // send Ether to user
        }

        (, markets[asset].supplyRateMantissa) = markets[asset]
        .interestRateModel
        .getSupplyRate(
            asset,
            cash - amount,
            markets[asset].totalSupply
        );

        (, markets[asset].borrowRateMantissa) = markets[asset]
        .interestRateModel
        .getBorrowRate(
            asset,
            cash - amount,
            markets[asset].totalBorrows
        );
        //event EquityWithdrawn(address asset, uint equityAvailableBefore, uint amount, address owner)
        emit EquityWithdrawn(asset, equity, amount, admin);
    }

    /**
     * @dev Set WETH token contract address
     * @param wethContractAddress Enter the WETH token address
     */
    function setWethAddress(address wethContractAddress)
        public
        onlyOwner
        returns (bool success)
    {
        require(
            wethContractAddress != address(0),
            Error.ADDRESS_CANNOT_BE_0X00
        );
        wethAddress = wethContractAddress;
        WETHContract = AlkemiWETH(wethAddress);
        return true;
    }

    /**
     * @dev Convert Ether supplied by user into WETH tokens and then supply corresponding WETH to user
     * @param etherAmount Amount of ether to be converted to WETH
     * @param user User account address
     */
    function supplyEther(address user, uint256 etherAmount)
        internal
        returns (bool)
    {
        user; // To silence the warning of unused local variable
        require(wethAddress != address(0), Error.WETH_ADDRESS_NOT_SET_ERROR);

        WETHContract.deposit{value:etherAmount}();
        return true;
    }

    /**
     * @dev Revert Ether paid by user back to user's account in case transaction fails due to some other reason
     * @param etherAmount Amount of ether to be sent back to user
     * @param user User account address
     */
    function revertEtherToUser(address user, uint256 etherAmount) internal {
        if (etherAmount > 0) {
            payable(user).transfer(etherAmount);
        }
    }

    /**
     * @notice supply `amount` of `asset` (which must be supported) to `msg.sender` in the protocol
     * @dev add amount of supported asset to msg.sender's account
     * @param asset The market asset to supply
     * @param amount The amount to supply
     * @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
     */
        function supply(address asset, uint256 amount)
        public
        payable
        nonReentrant
        isPaused
        isMarketSuppported(asset)
        returns (string memory)
    {
        if(asset == wethAddress && amount != msg.value) {
            revertEtherToUser(msg.sender, msg.value);
            revert(Error.ETHER_AMOUNT_MISMATCH_ERROR);
        }

        refreshAlkSupplyIndex(asset, msg.sender, false);

        Market storage market = markets[asset];
        Balance storage balance = supplyBalances[msg.sender][asset];

        ProtocolLocalVars memory localResults; // Holds all our uint calculation results
        bool success; // Re-used for every function call that includes an Error in its return value(s).
        bool rateCalculationResultCode; // Used for 2 interest rate calculation calls

        if (asset != wethAddress) {
            // WETH is supplied to AlkemiEarnPublic contract in case of ETH automatically
            // Fail gracefully if asset is not approved or has insufficient balance
            revertEtherToUser(msg.sender, msg.value);
            checkTransferIn(asset, msg.sender, amount);
        }

        // We calculate the newSupplyIndex, user's supplyCurrent and supplyUpdated for the asset
        localResults.newSupplyIndex = calculateInterestIndex(
            market.supplyIndex,
            market.supplyRateMantissa,
            market.blockNumber,
            block.number
        );

        (success,localResults.userSupplyCurrent) = calculateBalance(
            balance.principal,
            balance.interestIndex,
            localResults.newSupplyIndex
        );
        if (!success) {
            revertEtherToUser(msg.sender, msg.value);
            return (Error.ACCUMULATED_SUPPLY_BALANCE_CALCULATION_FAILED);
        }

        (success, localResults.userSupplyUpdated) = add(
            localResults.userSupplyCurrent,
            amount
        );
        if (!success) {
            revertEtherToUser(msg.sender, msg.value);
            return (Error.NEW_TOTAL_BALANCE_CALCULATION_FAILED);
        }

        // We calculate the protocol's totalSupply by subtracting the user's prior checkpointed balance, adding user's updated supply
        (success, localResults.newTotalSupply) = addThenSub(
            market.totalSupply,
            localResults.userSupplyUpdated,
            balance.principal
        );
        if (!success) {
            revertEtherToUser(msg.sender, msg.value);
            return (Error.NEW_TOTAL_SUPPLY_CALCULATION_FAILED);
        }

        // We need to calculate what the updated cash will be after we transfer in from user
        localResults.currentCash = getCash(asset);

        (success, localResults.updatedCash) = add(localResults.currentCash, amount);
        if (!success) {
            revertEtherToUser(msg.sender, msg.value);
            return (Error.NEW_TOTAL_CASH_CALCULATION_FAILED);
        }

        // The utilization rate has changed! We calculate a new supply index and borrow index for the asset, and save it.
        (rateCalculationResultCode, localResults.newSupplyRateMantissa) = market
        .interestRateModel
        .getSupplyRate(asset, localResults.updatedCash, market.totalBorrows);
        if (!rateCalculationResultCode) {
            revertEtherToUser(msg.sender, msg.value);
            return (Error.SUPPLY_RATE_CALCULATION_FAILED);
        }

        // We calculate the newBorrowIndex (we already had newSupplyIndex)
        localResults.newBorrowIndex = calculateInterestIndex(
            market.borrowIndex,
            market.borrowRateMantissa,
            market.blockNumber,
            block.number
        );

        (rateCalculationResultCode, localResults.newBorrowRateMantissa) = market
        .interestRateModel
        .getBorrowRate(asset, localResults.updatedCash, market.totalBorrows);
        if (!rateCalculationResultCode) {
            revertEtherToUser(msg.sender, msg.value);
            return (Error.BORROW_RATE_CALCULATION_FAILED);
        }

        /////////////////////////
        // EFFECTS & INTERACTIONS
        // (No safe failures beyond this point)

        // Save market updates
        market.blockNumber = block.number;
        market.totalSupply = localResults.newTotalSupply;
        market.supplyRateMantissa = localResults.newSupplyRateMantissa;
        market.supplyIndex = localResults.newSupplyIndex;
        market.borrowRateMantissa = localResults.newBorrowRateMantissa;
        market.borrowIndex = localResults.newBorrowIndex;

        // Save user updates
        localResults.startingBalance = balance.principal; // save for use in `SupplyReceived` event
        balance.principal = localResults.userSupplyUpdated;
        balance.interestIndex = localResults.newSupplyIndex;

        if (asset != wethAddress) {
            // WETH is supplied to AlkemiEarnPublic contract in case of ETH automatically
            // We ERC-20 transfer the asset into the protocol (note: pre-conditions already checked above)
            revertEtherToUser(msg.sender, msg.value);
            doTransferIn(asset, msg.sender, amount);
        } else {
            if (msg.value == amount) {
                supplyEther(msg.sender, msg.value);
            } else {
                revertEtherToUser(msg.sender, msg.value);
                return (Error.ETHER_AMOUNT_MISMATCH_ERROR);
            }
        }

        emit SupplyReceived(
            msg.sender,
            asset,
            amount,
            localResults.startingBalance,
            balance.principal
        );

        return (Error.NO_ERROR); // success
    }

    /**
     * @notice withdraw `amount` of `ether` from sender's account to sender's address
     * @dev withdraw `amount` of `ether` from msg.sender's account to msg.sender
     * @param etherAmount Amount of ether to be converted to WETH
     * @param user User account address
     */
    function withdrawEther(address user, uint256 etherAmount)
        internal
    {
        WETHContract.withdraw(user, etherAmount);
    }

    /**
     * @notice withdraw `amount` of `asset` from sender's account to sender's address
     * @dev withdraw `amount` of `asset` from msg.sender's account to msg.sender
     * @param asset The market asset to withdraw
     * @param requestedAmount The amount to withdraw (or -1 for max)
     */
    function withdraw(address asset, uint256 requestedAmount)
        public
        payable
        nonReentrant
        isPaused
    {
        refreshAlkSupplyIndex(asset, msg.sender, false);

        Market storage market = markets[asset];
        Balance storage supplyBalance = supplyBalances[msg.sender][asset];

        ProtocolLocalVars memory localResults; // Holds all our calculation results
        bool success; // Re-used for every function call that includes an Error in its return value(s).
        bool rateCalculationResultCode; // Used for 2 interest rate calculation calls

        // We calculate the user's accountLiquidity and accountShortfall.
        (
            localResults.accountLiquidity,
            localResults.accountShortfall
        ) = calculateAccountLiquidity(msg.sender);

        // We calculate the newSupplyIndex, user's supplyCurrent and supplyUpdated for the asset
        localResults.newSupplyIndex = calculateInterestIndex(
            market.supplyIndex,
            market.supplyRateMantissa,
            market.blockNumber,
            block.number
        );

        (success,localResults.userSupplyCurrent) = calculateBalance(
            supplyBalance.principal,
            supplyBalance.interestIndex,
            localResults.newSupplyIndex
        );
        require(success, Error.ACCUMULATED_SUPPLY_BALANCE_CALCULATION_FAILED); 

        // If the user specifies -1 amount to withdraw ("max"),  withdrawAmount => the lesser of withdrawCapacity and supplyCurrent
        if (requestedAmount == type(uint128).max) {
            localResults.withdrawCapacity = getAssetAmountForValue(
                asset,
                localResults.accountLiquidity
            );

            localResults.withdrawAmount = min(
                localResults.withdrawCapacity,
                localResults.userSupplyCurrent
            );
        } else {
            localResults.withdrawAmount = requestedAmount;
        }

        // From here on we should NOT use requestedAmount.

        // Fail gracefully if protocol has insufficient cash
        // If protocol has insufficient cash, the sub operation will underflow.
        localResults.currentCash = getCash(asset);
        (success, localResults.updatedCash) = sub(
            localResults.currentCash,
            localResults.withdrawAmount
        );
        require(success, Error.TRANSFER_OUT_FAILED); 

        // We check that the amount is less than or equal to supplyCurrent
        // If amount is greater than supplyCurrent, this will fail with Error.INTEGER_UNDERFLOW
        (success, localResults.userSupplyUpdated) = sub(
            localResults.userSupplyCurrent,
            localResults.withdrawAmount
        );
        require(success, Error.NEW_TOTAL_BALANCE_CALCULATION_FAILED); 

        // Fail if customer already has a shortfall
        require(isZeroExp(localResults.accountShortfall), Error.INSUFFICIENT_LIQUIDITY); 

        // We want to know the user's withdrawCapacity, denominated in the asset
        // Customer's withdrawCapacity of asset is (accountLiquidity in Eth)/ (price of asset in Eth)
        // Equivalently, we calculate the eth value of the withdrawal amount and compare it directly to the accountLiquidity in Eth
        localResults.ethValueOfWithdrawal = getPriceForAssetAmount(
            asset,
            localResults.withdrawAmount
        ); // amount * oraclePrice = ethValueOfWithdrawal

        // We check that the amount is less than withdrawCapacity (here), and less than or equal to supplyCurrent (below)
        success = lessThanExp(localResults.accountLiquidity,localResults.ethValueOfWithdrawal);
        require(!success, Error.INSUFFICIENT_LIQUIDITY); 

        // We calculate the protocol's totalSupply by subtracting the user's prior checkpointed balance, adding user's updated supply.
        // Note that, even though the customer is withdrawing, if they've accumulated a lot of interest since their last
        // action, the updated balance *could* be higher than the prior checkpointed balance.
        (success, localResults.newTotalSupply) = addThenSub(
            market.totalSupply,
            localResults.userSupplyUpdated,
            supplyBalance.principal
        );
        require(success, Error.NEW_TOTAL_SUPPLY_CALCULATION_FAILED); 

        // The utilization rate has changed! We calculate a new supply index and borrow index for the asset, and save it.
        (rateCalculationResultCode, localResults.newSupplyRateMantissa) = market
        .interestRateModel
        .getSupplyRate(asset, localResults.updatedCash, market.totalBorrows);
        require(rateCalculationResultCode, Error.SUPPLY_RATE_CALCULATION_FAILED); 

        // We calculate the newBorrowIndex
        localResults.newBorrowIndex = calculateInterestIndex(
            market.borrowIndex,
            market.borrowRateMantissa,
            market.blockNumber,
            block.number
        );

        (rateCalculationResultCode, localResults.newBorrowRateMantissa) = market
        .interestRateModel
        .getBorrowRate(asset, localResults.updatedCash, market.totalBorrows);
        require(rateCalculationResultCode, Error.BORROW_RATE_CALCULATION_FAILED); 

        /////////////////////////
        // EFFECTS & INTERACTIONS
        // (No safe failures beyond this point)

        // Save market updates
        market.blockNumber = block.number;
        market.totalSupply = localResults.newTotalSupply;
        market.supplyRateMantissa = localResults.newSupplyRateMantissa;
        market.supplyIndex = localResults.newSupplyIndex;
        market.borrowRateMantissa = localResults.newBorrowRateMantissa;
        market.borrowIndex = localResults.newBorrowIndex;

        // Save user updates
        localResults.startingBalance = supplyBalance.principal; // save for use in `SupplyWithdrawn` event
        supplyBalance.principal = localResults.userSupplyUpdated;
        supplyBalance.interestIndex = localResults.newSupplyIndex;

        if (asset != wethAddress) {
            // Withdrawal should happen as Ether directly
            // We ERC-20 transfer the asset into the protocol (note: pre-conditions already checked above)
            doTransferOut(asset, msg.sender, localResults.withdrawAmount);
        } else {
            withdrawEther(msg.sender, localResults.withdrawAmount); // send Ether to user
        }

        emit SupplyWithdrawn(
            msg.sender,
            asset,
            localResults.withdrawAmount,
            localResults.startingBalance,
            supplyBalance.principal
        );
    }

    /**
     * @dev Gets the user's account liquidity and account shortfall balances. This includes
     *      any accumulated interest thus far but does NOT actually update anything in
     *      storage, it simply calculates the account liquidity and shortfall with liquidity being
     *      returned as the first Exp, ie (Error, accountLiquidity, accountShortfall).
     * @return Return values are expressed in 1e18 scale
     */
    function calculateAccountLiquidity(address userAddress)
        internal
        view
        returns (
            Exp memory,
            Exp memory
        )
    {
        Exp memory sumSupplyValuesMantissa;
        Exp memory sumBorrowValuesMantissa;
        (
            sumSupplyValuesMantissa,
            sumBorrowValuesMantissa
        ) = calculateAccountValuesInternal(userAddress);

        Exp memory result;

        Exp memory sumSupplyValuesFinal = Exp({
            mantissa: sumSupplyValuesMantissa.mantissa
        });
        Exp memory sumBorrowValuesFinal; // need to apply collateral ratio

        sumBorrowValuesFinal = mulExp(
            collateralRatio,
            Exp({mantissa: sumBorrowValuesMantissa.mantissa})
        );

        // if sumSupplies < sumBorrows, then the user is under collateralized and has account shortfall.
        // else the user meets the collateral ratio and has account liquidity.
        if (lessThanExp(sumSupplyValuesFinal, sumBorrowValuesFinal)) {
            // accountShortfall = borrows - supplies
            result = subExp(sumBorrowValuesFinal, sumSupplyValuesFinal);

            return (Exp({mantissa: 0}), result);
        } else {
            // accountLiquidity = supplies - borrows
            result = subExp(sumSupplyValuesFinal, sumBorrowValuesFinal);

            return (result, Exp({mantissa: 0}));
        }
    }

    /**
     * @notice Gets the ETH values of the user's accumulated supply and borrow balances, scaled by 10e18.
     *         This includes any accumulated interest thus far but does NOT actually update anything in
     *         storage
     * @dev Gets ETH values of accumulated supply and borrow balances
     * @param userAddress account for which to sum values
     * @return (error code, sum ETH value of supplies scaled by 10e18, sum ETH value of borrows scaled by 10e18)
     */
    function calculateAccountValuesInternal(address userAddress)
        internal
        view
        returns (
            Exp memory,
            Exp memory
        )
    {
        bool success;
        /** By definition, all collateralMarkets are those that contribute to the user's
         * liquidity and shortfall so we need only loop through those markets.
         * To handle avoiding intermediate negative results, we will sum all the user's
         * supply balances and borrow balances (with collateral ratio) separately and then
         * subtract the sums at the end.
         */

        AccountValueLocalVars memory localResults; // Re-used for all intermediate results
        localResults.sumSupplies = Exp({mantissa: 0});
        localResults.sumBorrows = Exp({mantissa: 0});
        localResults.collateralMarketsLength = collateralMarkets.length;

        for (uint256 i = 0; i < localResults.collateralMarketsLength; i++) {
            localResults.assetAddress = collateralMarkets[i];
            Market storage currentMarket = markets[localResults.assetAddress];
            Balance storage supplyBalance = supplyBalances[userAddress][
                localResults.assetAddress
            ];
            Balance storage borrowBalance = borrowBalances[userAddress][
                localResults.assetAddress
            ];

            if (supplyBalance.principal > 0) {
                // We calculate the newSupplyIndex and user’s supplyCurrent (includes interest)
                localResults.newSupplyIndex = calculateInterestIndex(
                    currentMarket.supplyIndex,
                    currentMarket.supplyRateMantissa,
                    currentMarket.blockNumber,
                    block.number
                );

                (success,localResults.userSupplyCurrent) = calculateBalance(
                    supplyBalance.principal,
                    supplyBalance.interestIndex,
                    localResults.newSupplyIndex
                );
                if (!success) {
                    return (Exp({mantissa: 0}), Exp({mantissa: 0}));
                }

                // We have the user's supply balance with interest so let's multiply by the asset price to get the total value
                localResults.supplyTotalValue = getPriceForAssetAmount(
                    localResults.assetAddress,
                    localResults.userSupplyCurrent
                ); // supplyCurrent * oraclePrice = supplyValueInEth

                // Add this to our running sum of supplies
                localResults.sumSupplies = addExp(
                    localResults.supplyTotalValue,
                    localResults.sumSupplies
                );
            }

            if (borrowBalance.principal > 0) {
                // We perform a similar actions to get the user's borrow balance
                localResults.newBorrowIndex = calculateInterestIndex(
                    currentMarket.borrowIndex,
                    currentMarket.borrowRateMantissa,
                    currentMarket.blockNumber,
                    block.number
                );

                (success,localResults.userBorrowCurrent) = calculateBalance(
                    borrowBalance.principal,
                    borrowBalance.interestIndex,
                    localResults.newBorrowIndex
                );
                if (!success) {
                    return (Exp({mantissa: 0}), Exp({mantissa: 0}));
                }

                // We have the user's borrow balance with interest so let's multiply by the asset price to get the total value
                localResults.borrowTotalValue = getPriceForAssetAmount(
                    localResults.assetAddress,
                    localResults.userBorrowCurrent
                ); // borrowCurrent * oraclePrice = borrowValueInEth

                // Add this to our running sum of borrows
                localResults.sumBorrows = addExp(
                    localResults.borrowTotalValue,
                    localResults.sumBorrows
                );
            }
        }

        return (
            localResults.sumSupplies,
            localResults.sumBorrows
        );
    }

    /**
     * @notice Gets the ETH values of the user's accumulated supply and borrow balances, scaled by 10e18.
     *         This includes any accumulated interest thus far but does NOT actually update anything in
     *         storage
     * @dev Gets ETH values of accumulated supply and borrow balances
     * @param userAddress account for which to sum values
     * @return (uint 0=success; otherwise a failure (see ErrorReporter.sol for details),
     *          sum ETH value of supplies scaled by 10e18,
     *          sum ETH value of borrows scaled by 10e18)
     */
    function calculateAccountValues(address userAddress)
        public
        view
        returns (
            uint256,
            uint256
        )
    {
        (
            Exp memory supplyValue,
            Exp memory borrowValue
        ) = calculateAccountValuesInternal(userAddress);

        return (supplyValue.mantissa, borrowValue.mantissa);
    }

    /**
     * @notice Users repay borrowed assets from their own address to the protocol.
     * @param asset The market asset to repay
     * @param amount The amount to repay (or -1 for max)
     * @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
     */
    function repayBorrow(address asset, uint256 amount)
        public
        payable
        nonReentrant
        isPaused
        returns (string memory)
    {
        if(asset == wethAddress && amount != msg.value) {
            revertEtherToUser(msg.sender, msg.value);
            revert(Error.ETHER_AMOUNT_MISMATCH_ERROR);
        }
        refreshAlkBorrowIndex(asset, msg.sender, false);
        ProtocolLocalVars memory localResults;
        Market storage market = markets[asset];
        Balance storage borrowBalance = borrowBalances[msg.sender][asset];
        bool success;
        bool rateCalculationResultCode;

        // We calculate the newBorrowIndex, user's borrowCurrent and borrowUpdated for the asset
        localResults.newBorrowIndex = calculateInterestIndex(
            market.borrowIndex,
            market.borrowRateMantissa,
            market.blockNumber,
            block.number
        );

        (success,localResults.userBorrowCurrent) = calculateBalance(
            borrowBalance.principal,
            borrowBalance.interestIndex,
            localResults.newBorrowIndex
        );
        if (!success) {
            revertEtherToUser(msg.sender, msg.value);
            return (Error.ACCUMULATED_BORROW_BALANCE_CALCULATION_FAILED);
        }

        uint256 reimburseAmount;
        // If the user specifies -1 amount to repay (“max”), repayAmount =>
        // the lesser of the senders ERC-20 balance and borrowCurrent
        if (asset != wethAddress) {
            if (amount == type(uint128).max) {
                localResults.repayAmount = min(
                    getBalanceOf(asset, msg.sender),
                    localResults.userBorrowCurrent
                );
            } else {
                localResults.repayAmount = amount;
            }
        } else {
            // To calculate the actual repay use has to do and reimburse the excess amount of ETH collected
            if (amount > localResults.userBorrowCurrent) {
                localResults.repayAmount = localResults.userBorrowCurrent;
                (success, reimburseAmount) = sub(
                    amount,
                    localResults.userBorrowCurrent
                ); // reimbursement called at the end to make sure function does not have any other errors
                if (!success) {
                    revertEtherToUser(msg.sender, msg.value);
                    return Error.NEW_TOTAL_BALANCE_CALCULATION_FAILED;
                }
            } else {
                localResults.repayAmount = amount;
            }
        }

        // Subtract the `repayAmount` from the `userBorrowCurrent` to get `userBorrowUpdated`
        // Note: this checks that repayAmount is less than borrowCurrent
        (success, localResults.userBorrowUpdated) = sub(
            localResults.userBorrowCurrent,
            localResults.repayAmount
        );
        if (!success) {
            revertEtherToUser(msg.sender, msg.value);
            return Error.NEW_TOTAL_BALANCE_CALCULATION_FAILED;
        }

        // Fail gracefully if asset is not approved or has insufficient balance
        // Note: this checks that repayAmount is less than or equal to their ERC-20 balance
        if (asset != wethAddress) {
            // WETH is supplied to AlkemiEarnPublic contract in case of ETH automatically
            revertEtherToUser(msg.sender, msg.value);
            checkTransferIn(asset, msg.sender, localResults.repayAmount);
        }
        

        // We calculate the protocol's totalBorrow by subtracting the user's prior checkpointed balance, adding user's updated borrow
        // Note that, even though the customer is paying some of their borrow, if they've accumulated a lot of interest since their last
        // action, the updated balance *could* be higher than the prior checkpointed balance.
        (success, localResults.newTotalBorrows) = addThenSub(
            market.totalBorrows,
            localResults.userBorrowUpdated,
            borrowBalance.principal
        );
        if (!success) {
            revertEtherToUser(msg.sender, msg.value);
            return Error.NEW_TOTAL_BORROW_CALCULATION_FAILED;
        }

        // We need to calculate what the updated cash will be after we transfer in from user
        localResults.currentCash = getCash(asset);

        (success, localResults.updatedCash) = add(
            localResults.currentCash,
            localResults.repayAmount
        );
        if (!success) {
            revertEtherToUser(msg.sender, msg.value);
            return Error.NEW_TOTAL_CASH_CALCULATION_FAILED;
        }

        // The utilization rate has changed! We calculate a new supply index and borrow index for the asset, and save it.

        // We calculate the newSupplyIndex, but we have newBorrowIndex already
        localResults.newSupplyIndex = calculateInterestIndex(
            market.supplyIndex,
            market.supplyRateMantissa,
            market.blockNumber,
            block.number
        );

        (rateCalculationResultCode, localResults.newSupplyRateMantissa) = market
        .interestRateModel
        .getSupplyRate(
            asset,
            localResults.updatedCash,
            localResults.newTotalBorrows
        );
        if (!rateCalculationResultCode) {
            revertEtherToUser(msg.sender, msg.value);
            return Error.SUPPLY_RATE_CALCULATION_FAILED;
        }

        (rateCalculationResultCode, localResults.newBorrowRateMantissa) = market
        .interestRateModel
        .getBorrowRate(
            asset,
            localResults.updatedCash,
            localResults.newTotalBorrows
        );
        if (!rateCalculationResultCode) {
            revertEtherToUser(msg.sender, msg.value);
            return Error.BORROW_RATE_CALCULATION_FAILED;
                    
        }

        /////////////////////////
        // EFFECTS & INTERACTIONS
        // (No safe failures beyond this point)

        // Save market updates
        market.blockNumber = block.number;
        market.totalBorrows = localResults.newTotalBorrows;
        market.supplyRateMantissa = localResults.newSupplyRateMantissa;
        market.supplyIndex = localResults.newSupplyIndex;
        market.borrowRateMantissa = localResults.newBorrowRateMantissa;
        market.borrowIndex = localResults.newBorrowIndex;

        // Save user updates
        localResults.startingBalance = borrowBalance.principal; // save for use in `BorrowRepaid` event
        borrowBalance.principal = localResults.userBorrowUpdated;
        borrowBalance.interestIndex = localResults.newBorrowIndex;

        if (asset != wethAddress) {
            // WETH is supplied to AlkemiEarnPublic contract in case of ETH automatically
            // We ERC-20 transfer the asset into the protocol (note: pre-conditions already checked above)
            revertEtherToUser(msg.sender, msg.value);
            doTransferIn(asset, msg.sender, localResults.repayAmount);
        } else {
            if (msg.value == amount) {
                supplyEther(
                    msg.sender,
                    localResults.repayAmount
                );
                //Repay excess funds
                if (reimburseAmount > 0) {
                    revertEtherToUser(msg.sender, reimburseAmount);
                }

            } else {
                revertEtherToUser(msg.sender, msg.value);
                return Error.ETHER_AMOUNT_MISMATCH_ERROR;
            }
        }

        supplyOriginationFeeAsAdmin(
            asset,
            msg.sender,
            localResults.repayAmount,
            market.supplyIndex
        );

        emit BorrowRepaid(
            msg.sender,
            asset,
            localResults.repayAmount,
            localResults.startingBalance,
            borrowBalance.principal
        );

        return (Error.NO_ERROR); // success
    }

    /**
     * @notice users repay all or some of an underwater borrow and receive collateral
     * @param targetAccount The account whose borrow should be liquidated
     * @param assetBorrow The market asset to repay
     * @param assetCollateral The borrower's market asset to receive in exchange
     * @param requestedAmountClose The amount to repay (or -1 for max)
     * @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
     */
    function liquidateBorrow(
        address targetAccount,
        address assetBorrow,
        address assetCollateral,
        uint256 requestedAmountClose
    ) public payable isPaused  returns (string memory){

        if(assetBorrow == wethAddress && requestedAmountClose != msg.value) {
            revertEtherToUser(msg.sender, msg.value);
            revert(Error.ETHER_AMOUNT_MISMATCH_ERROR);
        }
        refreshAlkSupplyIndex(assetCollateral, targetAccount, false);
        refreshAlkSupplyIndex(assetCollateral, msg.sender, false);
        refreshAlkBorrowIndex(assetBorrow, targetAccount, false);
        LiquidateLocalVars memory localResults;
        // Copy these addresses into the struct for use with `emitLiquidationEvent`
        // We'll use localResults.liquidator inside this function for clarity vs using msg.sender.
        localResults.targetAccount = targetAccount;
        localResults.assetBorrow = assetBorrow;
        localResults.liquidator = msg.sender;
        localResults.assetCollateral = assetCollateral;

        Market storage borrowMarket = markets[assetBorrow];
        Market storage collateralMarket = markets[assetCollateral];
        Balance storage borrowBalance_TargeUnderwaterAsset = borrowBalances[
            targetAccount
        ][assetBorrow];
        Balance storage supplyBalance_TargetCollateralAsset = supplyBalances[
            targetAccount
        ][assetCollateral];

        // Liquidator might already hold some of the collateral asset


            Balance storage supplyBalance_LiquidatorCollateralAsset
         = supplyBalances[localResults.liquidator][assetCollateral];

        bool rateCalculationResultCode; // Used for multiple interest rate calculation calls
        bool success; // re-used for all intermediate errors

        localResults.collateralPrice = fetchAssetPrice(assetCollateral);

        localResults.underwaterAssetPrice = fetchAssetPrice(assetBorrow);

        // We calculate newBorrowIndex_UnderwaterAsset and then use it to help calculate currentBorrowBalance_TargetUnderwaterAsset
        (
            localResults.newBorrowIndex_UnderwaterAsset
        ) = calculateInterestIndex(
            borrowMarket.borrowIndex,
            borrowMarket.borrowRateMantissa,
            borrowMarket.blockNumber,
            block.number
        );

        (
            success,
            localResults.currentBorrowBalance_TargetUnderwaterAsset
        ) = calculateBalance(
            borrowBalance_TargeUnderwaterAsset.principal,
            borrowBalance_TargeUnderwaterAsset.interestIndex,
            localResults.newBorrowIndex_UnderwaterAsset
        );
        if (!success) {
            return (Error.ACCUMULATED_BORROW_BALANCE_CALCULATION_FAILED);
        }

        // We calculate newSupplyIndex_CollateralAsset and then use it to help calculate currentSupplyBalance_TargetCollateralAsset
        (
            localResults.newSupplyIndex_CollateralAsset
        ) = calculateInterestIndex(
            collateralMarket.supplyIndex,
            collateralMarket.supplyRateMantissa,
            collateralMarket.blockNumber,
            block.number
        );

        (
            success,
            localResults.currentSupplyBalance_TargetCollateralAsset
        ) = calculateBalance(
            supplyBalance_TargetCollateralAsset.principal,
            supplyBalance_TargetCollateralAsset.interestIndex,
            localResults.newSupplyIndex_CollateralAsset
        );
        if (!success) {
            revertEtherToUser(msg.sender, msg.value);
            return (Error.ACCUMULATED_BALANCE_CALCULATION_FAILED_BCA);
        }

        // Liquidator may or may not already have some collateral asset.
        // If they do, we need to accumulate interest on it before adding the seized collateral to it.
        // We re-use newSupplyIndex_CollateralAsset calculated above to help calculate currentSupplyBalance_LiquidatorCollateralAsset
        (
            success,
            localResults.currentSupplyBalance_LiquidatorCollateralAsset
        ) = calculateBalance(
            supplyBalance_LiquidatorCollateralAsset.principal,
            supplyBalance_LiquidatorCollateralAsset.interestIndex,
            localResults.newSupplyIndex_CollateralAsset
        );
        if (!success) {
            revertEtherToUser(msg.sender, msg.value);
            return (Error.ACCUMULATED_BALANCE_CALCULATION_FAILED_LCA);
        }

        // We update the protocol's totalSupply for assetCollateral in 2 steps, first by adding target user's accumulated
        // interest and then by adding the liquidator's accumulated interest.

        // Step 1 of 2: We add the target user's supplyCurrent and subtract their checkpointedBalance
        // (which has the desired effect of adding accrued interest from the target user)
        (success, localResults.newTotalSupply_ProtocolCollateralAsset) = addThenSub(
            collateralMarket.totalSupply,
            localResults.currentSupplyBalance_TargetCollateralAsset,
            supplyBalance_TargetCollateralAsset.principal
        );
        if(!success) {
            return Error.NEW_TOTAL_BALANCE_CALCULATION_FAILED_BCA;
            } 

        // Step 2 of 2: We add the liquidator's supplyCurrent of collateral asset and subtract their checkpointedBalance
        // (which has the desired effect of adding accrued interest from the calling user)
        (success, localResults.newTotalSupply_ProtocolCollateralAsset) = addThenSub(
            localResults.newTotalSupply_ProtocolCollateralAsset,
            localResults.currentSupplyBalance_LiquidatorCollateralAsset,
            supplyBalance_LiquidatorCollateralAsset.principal
        );
        if(!success){
            return Error.NEW_TOTAL_BALANCE_CALCULATION_FAILED_LCA;
        }  

        // We calculate maxCloseableBorrowAmount_TargetUnderwaterAsset, the amount of borrow that can be closed from the target user
        // This is equal to the lesser of
        // 1. borrowCurrent; (already calculated)
        // 2. ONLY IF MARKET SUPPORTED: discountedRepayToEvenAmount:
        // discountedRepayToEvenAmount=
        //      shortfall / [Oracle price for the borrow * (collateralRatio - liquidationDiscount - 1)]
        // 3. discountedBorrowDenominatedCollateral
        //      [supplyCurrent / (1 + liquidationDiscount)] * (Oracle price for the collateral / Oracle price for the borrow)

        // Here we calculate item 3. discountedBorrowDenominatedCollateral =
        // [supplyCurrent / (1 + liquidationDiscount)] * (Oracle price for the collateral / Oracle price for the borrow)
        (
            localResults.discountedBorrowDenominatedCollateral
        ) = calculateDiscountedBorrowDenominatedCollateral(
            localResults.underwaterAssetPrice,
            localResults.collateralPrice,
            localResults.currentSupplyBalance_TargetCollateralAsset
        );

        if (borrowMarket.isSupported) {
            // Market is supported, so we calculate item 2 from above.
            (
                localResults.discountedRepayToEvenAmount
            ) = calculateDiscountedRepayToEvenAmount(
                targetAccount,
                localResults.underwaterAssetPrice,
                assetBorrow
            );

            // We need to do a two-step min to select from all 3 values
            // min1&3 = min(item 1, item 3)
            localResults.maxCloseableBorrowAmount_TargetUnderwaterAsset = min(
                localResults.currentBorrowBalance_TargetUnderwaterAsset,
                localResults.discountedBorrowDenominatedCollateral
            );

            // min1&3&2 = min(min1&3, 2)
            localResults.maxCloseableBorrowAmount_TargetUnderwaterAsset = min(
                localResults.maxCloseableBorrowAmount_TargetUnderwaterAsset,
                localResults.discountedRepayToEvenAmount
            );
        } else {
            // Market is not supported, so we don't need to calculate item 2.
            localResults.maxCloseableBorrowAmount_TargetUnderwaterAsset = min(
                localResults.currentBorrowBalance_TargetUnderwaterAsset,
                localResults.discountedBorrowDenominatedCollateral
            );
        }

        // If liquidateBorrowAmount = -1, then closeBorrowAmount_TargetUnderwaterAsset = maxCloseableBorrowAmount_TargetUnderwaterAsset
        if (assetBorrow != wethAddress) {
            if (requestedAmountClose == type(uint128).max) {
                localResults
                .closeBorrowAmount_TargetUnderwaterAsset = localResults
                .maxCloseableBorrowAmount_TargetUnderwaterAsset;
            } else {
                localResults
                .closeBorrowAmount_TargetUnderwaterAsset = requestedAmountClose;
            }
        } else {
            // To calculate the actual repay use has to do and reimburse the excess amount of ETH collected
            if (
                requestedAmountClose >
                localResults.maxCloseableBorrowAmount_TargetUnderwaterAsset
            ) {
                localResults
                .closeBorrowAmount_TargetUnderwaterAsset = localResults
                .maxCloseableBorrowAmount_TargetUnderwaterAsset;
                (success, localResults.reimburseAmount) = sub(
                    requestedAmountClose,
                    localResults.maxCloseableBorrowAmount_TargetUnderwaterAsset
                ); // reimbursement called at the end to make sure function does not have any other errors
                if(!success){
                    return Error.NEW_TOTAL_BALANCE_CALCULATION_FAILED;
                }  
            } else {
                localResults
                .closeBorrowAmount_TargetUnderwaterAsset = requestedAmountClose;
            }
        }

        // From here on, no more use of `requestedAmountClose`

        // Verify closeBorrowAmount_TargetUnderwaterAsset <= maxCloseableBorrowAmount_TargetUnderwaterAsset
        if(
            localResults.closeBorrowAmount_TargetUnderwaterAsset >
            localResults.maxCloseableBorrowAmount_TargetUnderwaterAsset
        ){
            return Error.INVALID_CLOSE_AMOUNT_REQUESTED;
        }

        // seizeSupplyAmount_TargetCollateralAsset = closeBorrowAmount_TargetUnderwaterAsset * priceBorrow/priceCollateral *(1+liquidationDiscount)
        (
            localResults.seizeSupplyAmount_TargetCollateralAsset
        ) = calculateAmountSeize(
            localResults.underwaterAssetPrice,
            localResults.collateralPrice,
            localResults.closeBorrowAmount_TargetUnderwaterAsset
        );

        // We are going to ERC-20 transfer closeBorrowAmount_TargetUnderwaterAsset of assetBorrow into protocol
        // Fail gracefully if asset is not approved or has insufficient balance
        if (assetBorrow != wethAddress) {
            // WETH is supplied to AlkemiEarnPublic contract in case of ETH automatically
            checkTransferIn(
                assetBorrow,
                localResults.liquidator,
                localResults.closeBorrowAmount_TargetUnderwaterAsset
            );
        }

        // We are going to repay the target user's borrow using the calling user's funds
        // We update the protocol's totalBorrow for assetBorrow, by subtracting the target user's prior checkpointed balance,
        // adding borrowCurrent, and subtracting closeBorrowAmount_TargetUnderwaterAsset.

        // Subtract the `closeBorrowAmount_TargetUnderwaterAsset` from the `currentBorrowBalance_TargetUnderwaterAsset` to get `updatedBorrowBalance_TargetUnderwaterAsset`
        (success, localResults.updatedBorrowBalance_TargetUnderwaterAsset) = sub(
            localResults.currentBorrowBalance_TargetUnderwaterAsset,
            localResults.closeBorrowAmount_TargetUnderwaterAsset
        );
        // We have ensured above that localResults.closeBorrowAmount_TargetUnderwaterAsset <= localResults.currentBorrowBalance_TargetUnderwaterAsset, so the sub can't underflow
        assert(!success);

        // We calculate the protocol's totalBorrow for assetBorrow by subtracting the user's prior checkpointed balance, adding user's updated borrow
        // Note that, even though the liquidator is paying some of the borrow, if the borrow has accumulated a lot of interest since the last
        // action, the updated balance *could* be higher than the prior checkpointed balance.
        (
            success,
            localResults.newTotalBorrows_ProtocolUnderwaterAsset
        ) = addThenSub(
            borrowMarket.totalBorrows,
            localResults.updatedBorrowBalance_TargetUnderwaterAsset,
            borrowBalance_TargeUnderwaterAsset.principal
        );
        if(!success) {
            return Error.NEW_TOTAL_BORROW_CALCULATION_FAILED;
        }

        // We need to calculate what the updated cash will be after we transfer in from liquidator
        localResults.currentCash_ProtocolUnderwaterAsset = getCash(assetBorrow);
        (success, localResults.updatedCash_ProtocolUnderwaterAsset) = add(
            localResults.currentCash_ProtocolUnderwaterAsset,
            localResults.closeBorrowAmount_TargetUnderwaterAsset
        );
        if(!success){
            return Error.NEW_TOTAL_CASH_CALCULATION_FAILED;
        } 
  

        // The utilization rate has changed! We calculate a new supply index, borrow index, supply rate, and borrow rate for assetBorrow
        // (Please note that we don't need to do the same thing for assetCollateral because neither cash nor borrows of assetCollateral happen in this process.)

        // We calculate the newSupplyIndex_UnderwaterAsset, but we already have newBorrowIndex_UnderwaterAsset so don't recalculate it.
        (
            localResults.newSupplyIndex_UnderwaterAsset
        ) = calculateInterestIndex(
            borrowMarket.supplyIndex,
            borrowMarket.supplyRateMantissa,
            borrowMarket.blockNumber,
            block.number
        );

        (
            rateCalculationResultCode,
            localResults.newSupplyRateMantissa_ProtocolUnderwaterAsset
        ) = borrowMarket.interestRateModel.getSupplyRate(
            assetBorrow,
            localResults.updatedCash_ProtocolUnderwaterAsset,
            localResults.newTotalBorrows_ProtocolUnderwaterAsset
        );
        if(!rateCalculationResultCode){
            return Error.SUPPLY_RATE_CALCULATION_FAILED;
        }

        (
            rateCalculationResultCode,
            localResults.newBorrowRateMantissa_ProtocolUnderwaterAsset
        ) = borrowMarket.interestRateModel.getBorrowRate(
            assetBorrow,
            localResults.updatedCash_ProtocolUnderwaterAsset,
            localResults.newTotalBorrows_ProtocolUnderwaterAsset
        );
        if(!rateCalculationResultCode){
            return Error.BORROW_RATE_CALCULATION_FAILED;
        }
        

        // Now we look at collateral. We calculated target user's accumulated supply balance and the supply index above.
        // Now we need to calculate the borrow index.
        // We don't need to calculate new rates for the collateral asset because we have not changed utilization:
        //  - accumulating interest on the target user's collateral does not change cash or borrows
        //  - transferring seized amount of collateral internally from the target user to the liquidator does not change cash or borrows.
        (
            localResults.newBorrowIndex_CollateralAsset
        ) = calculateInterestIndex(
            collateralMarket.borrowIndex,
            collateralMarket.borrowRateMantissa,
            collateralMarket.blockNumber,
            block.number
        );

        // We checkpoint the target user's assetCollateral supply balance, supplyCurrent - seizeSupplyAmount_TargetCollateralAsset at the updated index
        (success, localResults.updatedSupplyBalance_TargetCollateralAsset) = sub(
            localResults.currentSupplyBalance_TargetCollateralAsset,
            localResults.seizeSupplyAmount_TargetCollateralAsset
        );
        // The sub won't underflow because because seizeSupplyAmount_TargetCollateralAsset <= target user's collateral balance
        // maxCloseableBorrowAmount_TargetUnderwaterAsset is limited by the discounted borrow denominated collateral. That limits closeBorrowAmount_TargetUnderwaterAsset
        // which in turn limits seizeSupplyAmount_TargetCollateralAsset.
        assert(!success);

        // We checkpoint the liquidating user's assetCollateral supply balance, supplyCurrent + seizeSupplyAmount_TargetCollateralAsset at the updated index
        (
            success,
            localResults.updatedSupplyBalance_LiquidatorCollateralAsset
        ) = add(
            localResults.currentSupplyBalance_LiquidatorCollateralAsset,
            localResults.seizeSupplyAmount_TargetCollateralAsset
        );
        // We can't overflow here because if this would overflow, then we would have already overflowed above and failed
        // with LIQUIDATE_NEW_TOTAL_SUPPLY_BALANCE_CALCULATION_FAILED_LIQUIDATOR_COLLATERAL_ASSET
        assert(!success);

        /////////////////////////
        // EFFECTS & INTERACTIONS
        // (No safe failures beyond this point)

        // Save borrow market updates
        borrowMarket.blockNumber = block.number;
        borrowMarket.totalBorrows = localResults
        .newTotalBorrows_ProtocolUnderwaterAsset;
        // borrowMarket.totalSupply does not need to be updated
        borrowMarket.supplyRateMantissa = localResults
        .newSupplyRateMantissa_ProtocolUnderwaterAsset;
        borrowMarket.supplyIndex = localResults.newSupplyIndex_UnderwaterAsset;
        borrowMarket.borrowRateMantissa = localResults
        .newBorrowRateMantissa_ProtocolUnderwaterAsset;
        borrowMarket.borrowIndex = localResults.newBorrowIndex_UnderwaterAsset;

        // Save collateral market updates
        // We didn't calculate new rates for collateralMarket (because neither cash nor borrows changed), just new indexes and total supply.
        collateralMarket.blockNumber = block.number;
        collateralMarket.totalSupply = localResults
        .newTotalSupply_ProtocolCollateralAsset;
        collateralMarket.supplyIndex = localResults
        .newSupplyIndex_CollateralAsset;
        collateralMarket.borrowIndex = localResults
        .newBorrowIndex_CollateralAsset;

        // Save user updates

        localResults
        .startingBorrowBalance_TargetUnderwaterAsset = borrowBalance_TargeUnderwaterAsset
        .principal; // save for use in event
        borrowBalance_TargeUnderwaterAsset.principal = localResults
        .updatedBorrowBalance_TargetUnderwaterAsset;
        borrowBalance_TargeUnderwaterAsset.interestIndex = localResults
        .newBorrowIndex_UnderwaterAsset;

        localResults
        .startingSupplyBalance_TargetCollateralAsset = supplyBalance_TargetCollateralAsset
        .principal; // save for use in event
        supplyBalance_TargetCollateralAsset.principal = localResults
        .updatedSupplyBalance_TargetCollateralAsset;
        supplyBalance_TargetCollateralAsset.interestIndex = localResults
        .newSupplyIndex_CollateralAsset;

        localResults
        .startingSupplyBalance_LiquidatorCollateralAsset = supplyBalance_LiquidatorCollateralAsset
        .principal; // save for use in event
        supplyBalance_LiquidatorCollateralAsset.principal = localResults
        .updatedSupplyBalance_LiquidatorCollateralAsset;
        supplyBalance_LiquidatorCollateralAsset.interestIndex = localResults
        .newSupplyIndex_CollateralAsset;

        // We ERC-20 transfer the asset into the protocol (note: pre-conditions already checked above)
        if (assetBorrow != wethAddress) {
            // WETH is supplied to AlkemiEarnPublic contract in case of ETH automatically
            revertEtherToUser(msg.sender, msg.value);
            doTransferIn(
                assetBorrow,
                localResults.liquidator,
                localResults.closeBorrowAmount_TargetUnderwaterAsset
            );
        } else {
            if (msg.value == requestedAmountClose) {
                supplyEther(
                    localResults.liquidator,
                    localResults.closeBorrowAmount_TargetUnderwaterAsset
                );
                //Repay excess funds
                if (localResults.reimburseAmount > 0) {
                    revertEtherToUser(
                        localResults.liquidator,
                        localResults.reimburseAmount
                    );
                }
            } else {
                revertEtherToUser(msg.sender, msg.value);
                return Error.ETHER_AMOUNT_MISMATCH_ERROR;
            }
        }

        supplyOriginationFeeAsAdmin(
            assetBorrow,
            localResults.liquidator,
            localResults.closeBorrowAmount_TargetUnderwaterAsset,
            localResults.newSupplyIndex_UnderwaterAsset
        );

        emit BorrowLiquidated(
            localResults.targetAccount,
            localResults.assetBorrow,
            localResults.currentBorrowBalance_TargetUnderwaterAsset,
            localResults.closeBorrowAmount_TargetUnderwaterAsset,
            localResults.liquidator,
            localResults.assetCollateral,
            localResults.seizeSupplyAmount_TargetCollateralAsset
        );

        return (Error.NO_ERROR); // success
    }

    /**
     * @dev This should ONLY be called if market is supported. It returns shortfall / [Oracle price for the borrow * (collateralRatio - liquidationDiscount - 1)]
     *      If the market isn't supported, we support liquidation of asset regardless of shortfall because we want borrows of the unsupported asset to be closed.
     *      Note that if collateralRatio = liquidationDiscount + 1, then the denominator will be zero and the function will fail with DIVISION_BY_ZERO.
     * @return Return values are expressed in 1e18 scale
     */
    function calculateDiscountedRepayToEvenAmount(
        address targetAccount,
        Exp memory underwaterAssetPrice,
        address assetBorrow
    ) internal view returns (uint256) {
        Exp memory _accountLiquidity; // unused return value from calculateAccountLiquidity
        Exp memory accountShortfall_TargetUser;
        Exp memory collateralRatioMinusLiquidationDiscount; // collateralRatio - liquidationDiscount
        Exp memory discountedCollateralRatioMinusOne; // collateralRatioMinusLiquidationDiscount - 1, aka collateralRatio - liquidationDiscount - 1
        Exp memory discountedPrice_UnderwaterAsset;
        Exp memory rawResult;

        // we calculate the target user's shortfall, denominated in Ether, that the user is below the collateral ratio
        (
            _accountLiquidity,
            accountShortfall_TargetUser
        ) = calculateAccountLiquidity(targetAccount);

        collateralRatioMinusLiquidationDiscount = subExp(
            collateralRatio,
            liquidationDiscount
        );

        discountedCollateralRatioMinusOne = subExp(
            collateralRatioMinusLiquidationDiscount,
            Exp({mantissa: expScale})
        );

        discountedPrice_UnderwaterAsset = mulExp(
            underwaterAssetPrice,
            discountedCollateralRatioMinusOne
        );

        /* The liquidator may not repay more than what is allowed by the closeFactor */
        uint256 borrowBalance = this.getBorrowBalance(targetAccount, assetBorrow);
        Exp memory maxClose;
        maxClose = mulScalar(
            Exp({mantissa: closeFactorMantissa}),
            borrowBalance
        );

        rawResult = divExp(maxClose, discountedPrice_UnderwaterAsset);

        return (truncate(rawResult));
    }

    /**
     * @dev discountedBorrowDenominatedCollateral = [supplyCurrent / (1 + liquidationDiscount)] * (Oracle price for the collateral / Oracle price for the borrow)
     * @return Return values are expressed in 1e18 scale
     */
    function calculateDiscountedBorrowDenominatedCollateral(
        Exp memory underwaterAssetPrice,
        Exp memory collateralPrice,
        uint256 supplyCurrent_TargetCollateralAsset
    ) internal view returns (uint256) {
        // To avoid rounding issues, we re-order and group the operations so we do 1 division and only at the end
        // [supplyCurrent * (Oracle price for the collateral)] / [ (1 + liquidationDiscount) * (Oracle price for the borrow) ]
        Exp memory onePlusLiquidationDiscount; // (1 + liquidationDiscount)
        Exp memory supplyCurrentTimesOracleCollateral; // supplyCurrent * Oracle price for the collateral
        Exp memory onePlusLiquidationDiscountTimesOracleBorrow; // (1 + liquidationDiscount) * Oracle price for the borrow
        Exp memory rawResult;

        onePlusLiquidationDiscount = addExp(
            Exp({mantissa: expScale}),
            liquidationDiscount
        );
        supplyCurrentTimesOracleCollateral = mulScalar(
            collateralPrice,
            supplyCurrent_TargetCollateralAsset
        );

        onePlusLiquidationDiscountTimesOracleBorrow = mulExp(
            onePlusLiquidationDiscount,
            underwaterAssetPrice
        );

        rawResult = divExp(
            supplyCurrentTimesOracleCollateral,
            onePlusLiquidationDiscountTimesOracleBorrow
        );

        return (truncate(rawResult));
    }

    /**
     * @dev returns closeBorrowAmount_TargetUnderwaterAsset * (1+liquidationDiscount) * priceBorrow/priceCollateral
     * @return Return values are expressed in 1e18 scale
     */
    function calculateAmountSeize(
        Exp memory underwaterAssetPrice,
        Exp memory collateralPrice,
        uint256 closeBorrowAmount_TargetUnderwaterAsset
    ) internal view returns (uint256) {
        // To avoid rounding issues, we re-order and group the operations to move the division to the end, rather than just taking the ratio of the 2 prices:
        // underwaterAssetPrice * (1+liquidationDiscount) *closeBorrowAmount_TargetUnderwaterAsset) / collateralPrice

        // (1+liquidationDiscount)
        Exp memory liquidationMultiplier;

        // assetPrice-of-underwaterAsset * (1+liquidationDiscount)
        Exp memory priceUnderwaterAssetTimesLiquidationMultiplier;

        // priceUnderwaterAssetTimesLiquidationMultiplier * closeBorrowAmount_TargetUnderwaterAsset
        // or, expanded:
        // underwaterAssetPrice * (1+liquidationDiscount) * closeBorrowAmount_TargetUnderwaterAsset
        Exp memory finalNumerator;

        // finalNumerator / priceCollateral
        Exp memory rawResult;

        liquidationMultiplier = addExp(
            Exp({mantissa: expScale}),
            liquidationDiscount
        );

        priceUnderwaterAssetTimesLiquidationMultiplier = mulExp(
            underwaterAssetPrice,
            liquidationMultiplier
        );

        finalNumerator = mulScalar(
            priceUnderwaterAssetTimesLiquidationMultiplier,
            closeBorrowAmount_TargetUnderwaterAsset
        );

        rawResult = divExp(finalNumerator, collateralPrice);

        return (truncate(rawResult));
    }

    /**
     * @notice Users borrow assets from the protocol to their own address
     * @param asset The market asset to borrow
     * @param amount The amount to borrow
     */
    function borrow(address asset, uint256 amount)
        public
        payable
        nonReentrant
        isPaused
        //isMarketSuppported(asset)
    {
        refreshAlkBorrowIndex(asset, msg.sender, false);
        ProtocolLocalVars memory localResults;
        Market storage market = markets[asset];
        Balance storage borrowBalance = borrowBalances[msg.sender][asset];

        bool success;
        bool rateCalculationResultCode;

        // We calculate the newBorrowIndex, user's borrowCurrent and borrowUpdated for the asset
        localResults.newBorrowIndex = calculateInterestIndex(
            market.borrowIndex,
            market.borrowRateMantissa,
            market.blockNumber,
            block.number
        );

        (success,localResults.userBorrowCurrent) = calculateBalance(
            borrowBalance.principal,
            borrowBalance.interestIndex,
            localResults.newBorrowIndex
        );
        require(success, Error.ACCUMULATED_BORROW_BALANCE_CALCULATION_FAILED);

        // Calculate origination fee.
        localResults.borrowAmountWithFee = calculateBorrowAmountWithFee(
            amount
        );

        uint256 orgFeeBalance = localResults.borrowAmountWithFee - amount;

        // Add the `borrowAmountWithFee` to the `userBorrowCurrent` to get `userBorrowUpdated`
        (success, localResults.userBorrowUpdated) = add(
            localResults.userBorrowCurrent,
            localResults.borrowAmountWithFee
        );
        require(success, Error.NEW_TOTAL_BALANCE_CALCULATION_FAILED);

        // We calculate the protocol's totalBorrow by subtracting the user's prior checkpointed balance, adding user's updated borrow with fee
        (success, localResults.newTotalBorrows) = addThenSub(
            market.totalBorrows,
            localResults.userBorrowUpdated,
            borrowBalance.principal
        );
        require(success, Error.NEW_TOTAL_BORROW_CALCULATION_FAILED);

        // Check customer liquidity
        (
            localResults.accountLiquidity,
            localResults.accountShortfall
        ) = calculateAccountLiquidity(msg.sender);

        // Fail if customer already has a shortfall
        require(isZeroExp(localResults.accountShortfall), Error.INSUFFICIENT_LIQUIDITY);

        // Would the customer have a shortfall after this borrow (including origination fee)?
        // We calculate the eth-equivalent value of (borrow amount + fee) of asset and fail if it exceeds accountLiquidity.
        // This implements: `[(collateralRatio*oraclea*borrowAmount)*(1+borrowFee)] > accountLiquidity`
        (
            localResults.ethValueOfBorrowAmountWithFee
        ) = getPriceForAssetAmountMulCollatRatio(
            asset,
            localResults.borrowAmountWithFee
        );

        require(
            !(lessThanExp(
                localResults.accountLiquidity,
                localResults.ethValueOfBorrowAmountWithFee
            )), Error.INSUFFICIENT_LIQUIDITY);

        // Fail gracefully if protocol has insufficient cash
        localResults.currentCash = getCash(asset);
        // We need to calculate what the updated cash will be after we transfer out to the user
        (success, localResults.updatedCash) = sub(localResults.currentCash, amount);
        require(success, Error.TOKEN_INSUFFICIENT_CASH);

        // The utilization rate has changed! We calculate a new supply index and borrow index for the asset, and save it.

        // We calculate the newSupplyIndex, but we have newBorrowIndex already
        localResults.newSupplyIndex = calculateInterestIndex(
            market.supplyIndex,
            market.supplyRateMantissa,
            market.blockNumber,
            block.number
        );

        (rateCalculationResultCode, localResults.newSupplyRateMantissa) = market
        .interestRateModel
        .getSupplyRate(
            asset,
            localResults.updatedCash,
            localResults.newTotalBorrows
        );
        require(rateCalculationResultCode, Error.SUPPLY_RATE_CALCULATION_FAILED);

        (rateCalculationResultCode, localResults.newBorrowRateMantissa) = market
        .interestRateModel
        .getBorrowRate(
            asset,
            localResults.updatedCash,
            localResults.newTotalBorrows
        );
        require(rateCalculationResultCode, Error.BORROW_RATE_CALCULATION_FAILED); 

        /////////////////////////
        // EFFECTS & INTERACTIONS
        // (No safe failures beyond this point)

        // Save market updates
        market.blockNumber = block.number;
        market.totalBorrows = localResults.newTotalBorrows;
        market.supplyRateMantissa = localResults.newSupplyRateMantissa;
        market.supplyIndex = localResults.newSupplyIndex;
        market.borrowRateMantissa = localResults.newBorrowRateMantissa;
        market.borrowIndex = localResults.newBorrowIndex;

        // Save user updates
        localResults.startingBalance = borrowBalance.principal; // save for use in `BorrowTaken` event
        borrowBalance.principal = localResults.userBorrowUpdated;
        borrowBalance.interestIndex = localResults.newBorrowIndex;

        originationFeeBalance[msg.sender][asset] += orgFeeBalance;

        if (asset != wethAddress) {
            // Withdrawal should happen as Ether directly
            // We ERC-20 transfer the asset into the protocol (note: pre-conditions already checked above)
            doTransferOut(asset, msg.sender, amount);
        } else {
            withdrawEther(msg.sender, amount); // send Ether to user
        }

        emit BorrowTaken(
            msg.sender,
            asset,
            amount,
            localResults.startingBalance,
            localResults.borrowAmountWithFee,
            borrowBalance.principal
        );

    }

    /**
     * @notice supply `amount` of `asset` (which must be supported) to `admin` in the protocol
     * @dev add amount of supported asset to admin's account
     * @param asset The market asset to supply
     * @param amount The amount to supply
     */
    function supplyOriginationFeeAsAdmin(
        address asset,
        address user,
        uint256 amount,
        uint256 newSupplyIndex
    ) private {
        refreshAlkSupplyIndex(asset, admin, false);
        uint256 originationFeeRepaid = 0;
        if (originationFeeBalance[user][asset] != 0) {
            if (amount < originationFeeBalance[user][asset]) {
                originationFeeRepaid = amount;
            } else {
                originationFeeRepaid = originationFeeBalance[user][asset];
            }
            Balance storage balance = supplyBalances[admin][asset];

            ProtocolLocalVars memory localResults; // Holds all our uint calculation results
            bool success; // Re-used for every function call that includes an Error in its return value(s).

            originationFeeBalance[user][asset] -= originationFeeRepaid;

            (success,localResults.userSupplyCurrent) = calculateBalance(
                balance.principal,
                balance.interestIndex,
                newSupplyIndex
            );
            revertIfError(success);

            (success, localResults.userSupplyUpdated) = add(
                localResults.userSupplyCurrent,
                originationFeeRepaid
            );
            revertIfError(success);

            // We calculate the protocol's totalSupply by subtracting the user's prior checkpointed balance, adding user's updated supply
            (success, localResults.newTotalSupply) = addThenSub(
                markets[asset].totalSupply,
                localResults.userSupplyUpdated,
                balance.principal
            );
            revertIfError(success);

            // Save market updates
            markets[asset].totalSupply = localResults.newTotalSupply;

            // Save user updates
            localResults.startingBalance = balance.principal;
            balance.principal = localResults.userSupplyUpdated;
            balance.interestIndex = newSupplyIndex;

            emit SupplyOrgFeeAsAdmin(
                admin,
                asset,
                originationFeeRepaid,
                localResults.startingBalance,
                localResults.userSupplyUpdated
            );
        }
    }

    /**
     * @notice Set the address of the Reward Control contract to be triggered to accrue ALK rewards for participants
     * @param _rewardControl The address of the underlying reward control contract
     * @return uint 0=success, otherwise a failure (see ErrorReporter.sol for details)
     */
    function setRewardControlAddress(address _rewardControl)
        external
        onlyOwner
        returns (bool)
    {

        require(
            address(rewardControl) != _rewardControl,
            "Same Reward Control address"
        );
        require(
            _rewardControl != address(0),
            Error.ADDRESS_CANNOT_BE_0X00
        );
        rewardControl = RewardControlInterface(_rewardControl);
        return true; // success
    }

    /**
     * @notice Trigger the underlying Reward Control contract to accrue ALK supply rewards for the supplier on the specified market
     * @param market The address of the market to accrue rewards
     * @param supplier The address of the supplier to accrue rewards
     * @param isVerified Verified / Public protocol
     */
    function refreshAlkSupplyIndex(
        address market,
        address supplier,
        bool isVerified
    ) internal {
        if (address(rewardControl) == address(0)) {
            return;
        }
        rewardControl.refreshAlkSupplyIndex(market, supplier, isVerified);
    }

    /**
     * @notice Trigger the underlying Reward Control contract to accrue ALK borrow rewards for the borrower on the specified market
     * @param market The address of the market to accrue rewards
     * @param borrower The address of the borrower to accrue rewards
     * @param isVerified Verified / Public protocol
     */
    function refreshAlkBorrowIndex(
        address market,
        address borrower,
        bool isVerified
    ) internal {
        if (address(rewardControl) == address(0)) {
            return;
        }
        rewardControl.refreshAlkBorrowIndex(market, borrower, isVerified);
    }

    /**
     * @notice Get supply and borrows for a market
     * @param asset The market asset to find balances of
     * @return updated supply and borrows
     */
    function getMarketBalances(address asset)
        public
        view
        returns (uint256, uint256)
    {
        uint256 newSupplyIndex;
        uint256 marketSupplyCurrent;
        uint256 newBorrowIndex;
        uint256 marketBorrowCurrent;
        bool success;

        Market storage market = markets[asset];

        // Calculate the newSupplyIndex, needed to calculate market's supplyCurrent
        newSupplyIndex = calculateInterestIndex(
            market.supplyIndex,
            market.supplyRateMantissa,
            market.blockNumber,
            block.number
        );

        // Use newSupplyIndex and stored principal to calculate the accumulated balance
        (success, marketSupplyCurrent) = calculateBalance(
            market.totalSupply,
            market.supplyIndex,
            newSupplyIndex
        );
        revertIfError(success);

        // Calculate the newBorrowIndex, needed to calculate market's borrowCurrent
        newBorrowIndex = calculateInterestIndex(
            market.borrowIndex,
            market.borrowRateMantissa,
            market.blockNumber,
            block.number
        );

        // Use newBorrowIndex and stored principal to calculate the accumulated balance
        (success,marketBorrowCurrent) = calculateBalance(
            market.totalBorrows,
            market.borrowIndex,
            newBorrowIndex
        );
        revertIfError(success);
        return (marketSupplyCurrent, marketBorrowCurrent);
    }

    /**
     * @dev Function to revert in case of an internal exception
     */
    function revertIfError(bool success) internal pure {
        require(success,
            Error.INTERNAL_EXCEPTION
        );
    }
}
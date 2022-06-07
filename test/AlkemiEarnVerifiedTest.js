const { getContract, readAndExecContract } = require("./Contract");
const { assets, getExpMantissa, bigNums } = require("./Utils");
const AlkemiEarnVerifiedHarness = getContract("./test/AlkemiEarnVerifiedHarness.sol");
const PriceOracleHarness = getContract("./test/PriceOracleHarness.sol");
const PriceOracle = getContract("./test/PriceOracleHarness.sol");
const EIP20 = getContract("./test/EIP20Harness.sol");
const StandardInterestRateModel1 = getContract("./InterestRateModel/FixedInterestRateModel.sol");
const StandardInterestRateModel = getContract("./AlkemiRateModel.sol");
const truffleAssert = require('truffle-assertions');

const addressZero = "0x0000000000000000000000000000000000000000";

contract("AlkemiEarnVerifiedTest", function ([root, ...accounts]) {
	const tokenTransferGas = 54687;
	const liquidationSetup = {
		totalTokenAmount: 2000,
		initialTokenBalanceLiquidator: 100, // liquidator holds this much outside of protocol
		initialTokenBalanceOtherSupplier: 100, // otherSupplier supplies this much, so we have cash for the target user's borrow
		initialCollateralAmount: 10, // target user supplies this as collateral when its price is high
		initialBorrowAmount: 10, // target user borrows this much when the collateral price is high
	};

	async function setupValidLiquidation(nonStandard = false) {
		// borrower supplies OMG and borrows DRGN
		// liquidator repays borrowed loan and seizes collateral collateral
		const borrower = accounts[1];
		const liquidator = accounts[2];
		const otherSupplier = accounts[3];
		const alkemiEarnVerifiedHarness =
			await AlkemiEarnVerifiedHarness.new().send({
				from: root,
			});
		await readAndExecContract(alkemiEarnVerifiedHarness, "initializer", [], {
			from: root,
		});
		await readAndExecContract(
			alkemiEarnVerifiedHarness,
			"_changeKYCAdmin",
			[root, true],
			{
				from: root,
			}
		);
		await readAndExecContract(
			alkemiEarnVerifiedHarness,
			"_changeCustomerKYC",
			[borrower, true],
			{
				from: root,
			}
		);
		await readAndExecContract(
			alkemiEarnVerifiedHarness,
			"_changeCustomerKYC",
			[otherSupplier, true],
			{
				from: root,
			}
		);
		await readAndExecContract(
			alkemiEarnVerifiedHarness,
			"_changeCustomerKYC",
			[liquidator, true],
			{
				from: root,
			}
		);
		await readAndExecContract(
			alkemiEarnVerifiedHarness,
			"_changeLiquidator",
			[liquidator, true],
			{
				from: root,
			}
		);
		const priceOracle = await PriceOracle.new().send({ from: root });
		await alkemiEarnVerifiedHarness.methods
			._adminFunctions(root, priceOracle._address, false, 1000000000000000,0,root,root)
			.send({ from: root });
		// Set up SimpleInterestRateModel for collateral and borrowed market. borrow rate is 50% per block
		const simpleInterestRateModel = await StandardInterestRateModel1
		.new(1, 5).send({from: root});
		

		const collateral = await EIP20.new(
			liquidationSetup.totalTokenAmount,
			"test omg",
			18,
			"omg"
		).send({ from: root });
		const borrowed = await EIP20.new(
			liquidationSetup.totalTokenAmount,
			"test drgn",
			18,
			"drgn"
		).send({ from: root });
		const price = getExpMantissa(0.0075);
			await priceOracle.methods
				.harnessSetAssetPrice(collateral._address, price)
				.send({ from: root });
			await priceOracle.methods
				.harnessSetAssetPrice(borrowed._address, price)
				.send({ from: root });

		// Support markets
		
		await alkemiEarnVerifiedHarness.methods
			.harnessSupportMarket(collateral._address)
			.send({ from: root });
		await alkemiEarnVerifiedHarness.methods
			.harnessSupportMarket(borrowed._address)
			.send({ from: root });

		// Add collateral market for omg & drgn
		await alkemiEarnVerifiedHarness.methods
			.harnessAddCollateralMarket(collateral._address)
			.send({ from: root });
		await alkemiEarnVerifiedHarness.methods
			.harnessAddCollateralMarket(borrowed._address)
			.send({ from: root });
		

		await alkemiEarnVerifiedHarness.methods
			._supportMarket(collateral._address, simpleInterestRateModel._address)
			.send({ from: root });
		await alkemiEarnVerifiedHarness.methods
			._supportMarket(borrowed._address, simpleInterestRateModel._address)
			.send({ from: root });

		// Set a required collateral ratio of 2:1
		await alkemiEarnVerifiedHarness.methods
			.harnessSetCollateralRatio(2, 1)
			.send({ from: root });

		// Give liquidator an approved balance of the borrowed token, borrowed, so he can repay part of the underwater loan
		await borrowed.methods
			.transfer(liquidator, liquidationSetup.initialTokenBalanceLiquidator)
			.send({ gas: tokenTransferGas, from: root });
		await borrowed.methods
			.approve(
				alkemiEarnVerifiedHarness._address,
				liquidationSetup.initialTokenBalanceLiquidator
			)
			.send({ from: liquidator });

		// Give the other supplier some borrow asset and supply it to protocol.
		// This is what will fund the borrow.
		await borrowed.methods
			.transfer(
				otherSupplier,
				liquidationSetup.initialTokenBalanceOtherSupplier
			)
			.send({ from: root });
		await borrowed.methods
			.approve(
				alkemiEarnVerifiedHarness._address,
				liquidationSetup.initialTokenBalanceOtherSupplier
			)
			.send({ from: otherSupplier });
		const deliverBorrowAssetResult = await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
			.supply(
				borrowed._address,
				liquidationSetup.initialTokenBalanceOtherSupplier
			)
			.send({ from: otherSupplier }));

		// Give borrower some collateral and supply it to compound
		await collateral.methods
			.transfer(borrower, liquidationSetup.initialCollateralAmount)
			.send({ from: root });
		await collateral.methods
			.approve(
				alkemiEarnVerifiedHarness._address,
				liquidationSetup.initialCollateralAmount
			)
			.send({ from: borrower });
		await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
			.supply(collateral._address, liquidationSetup.initialCollateralAmount)
			.send({ from: borrower }));	

		// Create the borrow
		await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
			.borrow(borrowed._address, liquidationSetup.initialBorrowAmount)
			.send({ from: borrower }));
		// Track and return this so callers can accurately calculate accrued interest on the borrow if they so desire.
		const borrowBlock = 1234564;
		const supplyCollateralBlock = 1234569;


		return {
			borrower: borrower,
			liquidator: liquidator,
			alkemiEarnVerifiedHarness: alkemiEarnVerifiedHarness,
			collateral: collateral,
			borrowed: borrowed,
			supplyCollateralBlock: supplyCollateralBlock,
			borrowBlock: borrowBlock,
		};
	}

	// Validates info from `setupValidLiquidation` given that the liquidation did NOT occur.
	async function validateFailedLiquidation(
		result,
		alkemiEarnVerifiedHarness,
		borrower,
		borrowed,
		collateral,
		liquidator
	) {

		// Started with 100, should still have 100
		const liquidatorTokenBalance = await borrowed.methods
			.balanceOf(liquidator)
			.call();

		// No collateral was seized
		const liquidatorCollateralBalance = await alkemiEarnVerifiedHarness.methods
			.getSupplyBalance(liquidator, collateral._address)
			.call();

		const borrowerBorrowBalance = await alkemiEarnVerifiedHarness.methods
			.getBorrowBalance(borrower, borrowed._address)
			.call();

		const borrowerCollateralBalance = await alkemiEarnVerifiedHarness.methods
			.getSupplyBalance(borrower, collateral._address)
			.call();
	}

	describe("admin / _setPendingAdmin", async () => {
		it("admin is initially set to root and pendingAdmin is 0", async () => {
			const alkemiEarnVerified = await AlkemiEarnVerifiedHarness.new().send({
				from: root,
			});
			await readAndExecContract(alkemiEarnVerified, "initializer", [], {
				from: root,
			});
			assert.matchesAddress(
				root,
				await alkemiEarnVerified.methods.admin().call()
			);
			assert.equal(
				addressZero,
				await alkemiEarnVerified.methods.pendingAdmin().call(),
				"pendingAdmin should be zero for a new contract"
			);
		});

		it("can be used by admin", async () => {
			const alkemiEarnVerified = await AlkemiEarnVerifiedHarness.new().send({
				from: root,
			});
			await readAndExecContract(alkemiEarnVerified, "initializer", [], {
				from: root,
			});
			await readAndExecContract(
				alkemiEarnVerified,
				"_adminFunctions",
				[accounts[1], accounts[0], false, 1000000000000000,0,accounts[0],accounts[0]],
				{ from: root }
			);

			assert.matchesAddress(
				accounts[1],
				await alkemiEarnVerified.methods.pendingAdmin().call()
			);
			assert.matchesAddress(
				root,
				await alkemiEarnVerified.methods.admin().call()
			);
		});
	});

	describe("oracle / _setOracle", async () => {
		it("is initially unset", async () => {
			const alkemiEarnVerified = await AlkemiEarnVerifiedHarness.new().send({
				from: root,
			});
			await readAndExecContract(alkemiEarnVerified, "initializer", [], {
				from: root,
			});
			assert.matchesAddress(
				addressZero,
				await alkemiEarnVerified.methods.priceOracle().call()
			);
		});

		it("it can be changed by admin", async () => {
			const alkemiEarnVerified = await AlkemiEarnVerifiedHarness.new().send({
				from: root,
			});
			await readAndExecContract(alkemiEarnVerified, "initializer", [], {
				from: root,
			});
			const priceOracle = await PriceOracle.new().send({ from: root });
			const [errorCode0, _tx0, _error0] = await readAndExecContract(
				alkemiEarnVerified,
				"_adminFunctions",
				[root, priceOracle._address, false, 1000000000000000,0,root,root],
				{ from: root }
			);
			assert.matchesAddress(
				priceOracle._address,
				await alkemiEarnVerified.methods.priceOracle().call()
			);
		});
	});

	describe("_setPaused", async () => {
		it("contract is not paused when created", async () => {
			const alkemiEarnVerified = await AlkemiEarnVerifiedHarness.new().send({
				from: root,
			});
			await readAndExecContract(alkemiEarnVerified, "initializer", [], {
				from: root,
			});

			const paused = await alkemiEarnVerified.methods.paused().call();
			assert.equal(
				paused,
				false,
				"newly-created contract should not be paused"
			);
		});

		it("changes state when requested by admin", async () => {
			const alkemiEarnVerified = await AlkemiEarnVerifiedHarness.new().send({
				from: root,
			});
			await readAndExecContract(alkemiEarnVerified, "initializer", [], {
				from: root,
			});

			await readAndExecContract(
				alkemiEarnVerified,
				"_adminFunctions",
				[accounts[0], accounts[0], true, 1000000000000000,0,accounts[0],accounts[0]],
				{ from: root, gas: 1000000 }
			);

			const paused = await alkemiEarnVerified.methods.paused().call();
			assert.equal(paused, true, "contract should be paused");

			await readAndExecContract(
				alkemiEarnVerified,
				"_adminFunctions",
				[accounts[0], accounts[0], false, 1000000000000000,0,accounts[0],accounts[0]],
				{ from: root, gas: 1000000 }
			);
		});

		it("accepts non-state change", async () => {
			const alkemiEarnVerified = await AlkemiEarnVerifiedHarness.new().send({
				from: root,
			});
			await readAndExecContract(alkemiEarnVerified, "initializer", [], {
				from: root,
			});

			 await readAndExecContract(
				alkemiEarnVerified,
				"_adminFunctions",
				[accounts[0], accounts[0], false, 1000000000000000,0,accounts[0],accounts[0]],
				{ from: root, gas: 1000000 }
			);

			const paused = await alkemiEarnVerified.methods.paused().call();
			assert.equal(paused, false, "contract should not be paused");

		});
	});

	describe("setWethAddress", async () => {
		it("is initially unset", async () => {
			const alkemiEarnVerified = await AlkemiEarnVerifiedHarness.new().send({
				from: root,
			});
			await readAndExecContract(alkemiEarnVerified, "initializer", [], {
				from: root,
			});

			assert.matchesAddress(
				addressZero,
				await alkemiEarnVerified.methods.WETHContract().call(),
			);
		});

		it("changes state when requested by admin", async () => {
			const alkemiEarnVerified = await AlkemiEarnVerifiedHarness.new().send({
				from: root,
			});
			await readAndExecContract(alkemiEarnVerified, "initializer", [], {
				from: root,
			});

			const WETH = await EIP20.new(
				(10 ** 18).toString(),
				"test eth",
				18,
				"eth"
			).send({
				from: accounts[0],
			});

			await readAndExecContract(
				alkemiEarnVerified,
				"_adminFunctions",
				[accounts[0], accounts[0], true, 1000000000000000,0,WETH._address,accounts[0]],
				{ from: root, gas: 1000000 }
			);
			

			assert.matchesAddress(
				WETH._address,
				await alkemiEarnVerified.methods.WETHContract().call()
				);
		});
	});

	describe("assetPrices", async () => {
		it("returns scaled price when available", async () => {
			const alkemiEarnVerified = await AlkemiEarnVerifiedHarness.new().send({
				from: root,
			});
			await readAndExecContract(alkemiEarnVerified, "initializer", [], {
				from: root,
			});
			const priceOracle = await PriceOracle.new().send({ from: root });
			await alkemiEarnVerified.methods
				._adminFunctions(root, priceOracle._address, false, 1000000000000000,0,root,root)
				.send({ from: root });
			const OMG = await EIP20.new(
				(10 ** 18).toString(),
				"test omg",
				18,
				"omg"
			).send({
				from: root,
			});

			const price = getExpMantissa(0.0075);
			await priceOracle.methods
				.harnessSetAssetPrice(OMG._address, price)
				.send({ from: root });

			const result = await alkemiEarnVerified.methods
				.assetPrices(OMG._address)
				.call();
			assert.equal(result, price, "OMG price");
		});

		it("returns 0 when price not available", async () => {
			const alkemiEarnVerified = await AlkemiEarnVerifiedHarness.new().send({
				from: root,
			});
			await readAndExecContract(alkemiEarnVerified, "initializer", [], {
				from: root,
			});
			const priceOracle = await PriceOracle.new().send({ from: root });
			await alkemiEarnVerified.methods
				._adminFunctions(root, priceOracle._address, false, 1000000000000000,0,root,root)
				.send({ from: root });
			const OMG = await EIP20.new(
				(10 ** 18).toString(),
				"test omg",
				18,
				"omg"
			).send({
				from: root,
			});

			const result = await alkemiEarnVerified.methods
				.assetPrices(OMG._address)
				.call();
			assert.equal(result, 0, "OMG should have no price");
		});
		// See test/AlkemiEarnVerified/AlkemiEarnVerifiedTest_AssetPrices.sol for test of unset oracle.
	});

	describe("_supportMarket", async () => {
		let standardInterestRateModel;

		before(async () => {
			// Deploy once since we're only calling pure functions
			standardInterestRateModel = await StandardInterestRateModel.new(
				"Test Rate Model",
				100,
				200,
				250,
				8000,
				3000,
				5000
			).send({
				from: accounts[0],
			});
		});
		it("succeeds and sets market", async () => {
			const alkemiEarnVerified = await AlkemiEarnVerifiedHarness.new().send({
				from: root,
			});
			await readAndExecContract(alkemiEarnVerified, "initializer", [], {
				from: root,
			});

			const asset = assets.OMG;

			await alkemiEarnVerified.methods
				.harnessSetAssetPriceMantissa(asset, getExpMantissa(0.5).toString(10))
				.send({ from: root });

			await readAndExecContract(
				alkemiEarnVerified,
				"_supportMarket",
				[asset, standardInterestRateModel._address],
				{ from: root }
			);
		});

		it("succeeds works a second time", async () => {
			const alkemiEarnVerified = await AlkemiEarnVerifiedHarness.new().send({
				from: root,
			});
			await readAndExecContract(alkemiEarnVerified, "initializer", [], {
				from: root,
			});
			
			const asset = assets.OMG;
			await alkemiEarnVerified.methods
				.harnessSetAssetPriceMantissa(asset, getExpMantissa(0.5).toString(10))
				.send({ from: root });

			await readAndExecContract(
				alkemiEarnVerified,
				"_supportMarket",
				[asset, standardInterestRateModel._address],
				{ from: root }
			);
			await readAndExecContract(
				alkemiEarnVerified,
				"_supportMarket",
				[asset, standardInterestRateModel._address],
				{ from: root }
			);
		});
	});

	describe("_withdrawEquity", async () => {

		it("fails if amount requested exceeds equity", async () => {
			const alkemiEarnVerified = await AlkemiEarnVerifiedHarness.new().send({
				from: root,
			});
			await readAndExecContract(alkemiEarnVerified, "initializer", [], {
				from: root,
			});
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: root,
			});
			const asset = OMG._address;

			// Give protocol cash
			await OMG.methods
				.harnessSetBalance(alkemiEarnVerified._address, 10000)
				.send({ from: root });

			// Configure market state for OMG: a supply of 1000, borrows of 2000 and supply and borrow indexes of 1.
			await alkemiEarnVerified.methods
				.harnessSetMarketDetails(OMG._address, 1000, 0, 1, 2000, 0, 1)
				.send({ from: root });

					// equity = 10000 + 2000 - 1000 = 11000. Try to withdraw only 4500, which should be allowed
			await readAndExecContract(
			alkemiEarnVerified,
			"_withdrawEquity",
			[asset, 11001],
			{ from: root, gas: 1000000 }
			);
	
		});

		it("fails if cash + borrows overflows", async () => {
			const alkemiEarnVerified = await AlkemiEarnVerifiedHarness.new().send({
				from: root,
			});
			await readAndExecContract(alkemiEarnVerified, "initializer", [], {
				from: root,
			});
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: root,
			});
			const asset = OMG._address;

			// Give protocol cash
			await OMG.methods
				.harnessSetBalance(alkemiEarnVerified._address, 10000)
				.send({ from: root });

			// Configure market state for OMG: a supply of 1, borrows of maxUint and supply and borrow indexes of 1.
			await alkemiEarnVerified.methods
				.harnessSetMarketDetails(
					OMG._address,
					1,
					0,
					1,
					bigNums.maxUint.toString(10),
					0,
					1
				)
				.send({ from: root });

			// cash of 1000 + borrows of maxUint should overflow
			await readAndExecContract(
				alkemiEarnVerified,
				"_withdrawEquity",
				[asset, 10],
				{ from: root, gas: 1000000 }
			);
		});

		it("fails if cash + borrows - supply underflows", async () => {
			const alkemiEarnVerified = await AlkemiEarnVerifiedHarness.new().send({
				from: root,
			});
			await readAndExecContract(alkemiEarnVerified, "initializer", [], {
				from: root,
			});
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: root,
			});
			const asset = OMG._address;

			// Give protocol cash
			await OMG.methods
				.harnessSetBalance(alkemiEarnVerified._address, 10000)
				.send({ from: root });

			// Configure market state for OMG: a supply of maxUint, borrows of 0 and supply and borrow indexes of 1.
			await alkemiEarnVerified.methods
				.harnessSetMarketDetails(
					OMG._address,
					bigNums.maxUint.toString(10),
					0,
					1,
					0,
					0,
					1
				)
				.send({ from: root });

			// cash of 1000 + 0 borrows - maxUint should underflow
			await readAndExecContract(
				alkemiEarnVerified,
				"_withdrawEquity",
				[asset, 10],
				{ from: root, gas: 1000000 }
			);

		});

		it("fails if transfer out fails", async () => {
			const alkemiEarnVerified = await AlkemiEarnVerifiedHarness.new().send({
				from: root,
			});
			await readAndExecContract(alkemiEarnVerified, "initializer", [], {
				from: root,
			});
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: root,
			});
			const asset = OMG._address;

			// Give protocol cash
			await OMG.methods
				.harnessSetBalance(alkemiEarnVerified._address, 10000)
				.send({ from: root });

			// Configure market state for OMG: a supply of 1000, borrows of 2000 and supply and borrow indexes of 1.
			await alkemiEarnVerified.methods
				.harnessSetMarketDetails(OMG._address, 1000, 0, 1, 2000, 0, 1)
				.send({ from: root });

			// equity = 10000 - (1000 + 2000) = 7000. Try to withdraw only 4500, which should be allowed
			// BUT we have configured the token harness to fail the transfer out
			await readAndExecContract(
				alkemiEarnVerified,
				"_withdrawEquity",
				[asset, 10],
				{ from: root, gas: 1000000 }
			);
		});

		it("emits log on success", async () => {
			const alkemiEarnVerified = await AlkemiEarnVerifiedHarness.new().send({
				from: root,
			});
			await readAndExecContract(alkemiEarnVerified, "initializer", [], {
				from: root,
			});
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: root,
			});
			const asset = OMG._address;

			// Give protocol cash
			await OMG.methods
				.harnessSetBalance(alkemiEarnVerified._address, 10000)
				.send({ from: root });

			// Configure market state for OMG: a supply of 1000, borrows of 2000 and supply and borrow indexes of 1.
			await alkemiEarnVerified.methods
				.harnessSetMarketDetails(OMG._address, 1000, 0, 1, 2000, 0, 1)
				.send({ from: root });

			// equity = 10000 + 2000 - 1000 = 11000. Try to withdraw only 4500, which should be allowed
			await readAndExecContract(
				alkemiEarnVerified,
				"_withdrawEquity",
				[asset, 4500],
				{ from: root, gas: 1000000 }
			);
		});
	});

	describe("supply", async () => {
		it("returns error and logs info if contract is paused", async () => {
			const alkemiEarnVerified = await AlkemiEarnVerifiedHarness.new().send({
				from: root,
			});
			await readAndExecContract(alkemiEarnVerified, "initializer", [], {
				from: root,
			});
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: root,
			});
			const customer = accounts[1];
		
			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, 100)
				.send({ gas: tokenTransferGas, from: root });
			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(alkemiEarnVerified._address, 95)
				.send({ from: root });

			await alkemiEarnVerified.methods
				._adminFunctions(root, root, true, 1000000000000000,0,root,root)
				.send({ from: root });

			await truffleAssert.reverts(alkemiEarnVerified.methods
				.supply(OMG._address, 90)
				.send({ from: root }));
		});

		it("returns error if new supply interest index calculation fails", async () => {
			const alkemiEarnVerified = await AlkemiEarnVerifiedHarness.new().send({
				from: root,
			});
			await readAndExecContract(alkemiEarnVerified, "initializer", [], {
				from: root,
			});

			const customer = accounts[1];
		
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: root,
			});

			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, 100)
				.send({ gas: tokenTransferGas, from: root });

			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(alkemiEarnVerified._address, 95)
				.send({ from: customer });

			await alkemiEarnVerified.methods
				.harnessSetAssetPriceMantissa(
					OMG._address,
					getExpMantissa(0.5).toString(10)
				)
				.send({ from: root });
			await alkemiEarnVerified.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: root });

			// Store a block number that should be HIGHER than the current block number so we'll get an underflow
			// when calculating block delta.
			await alkemiEarnVerified.methods
				.harnessSetMarketBlockNumber(OMG._address, -1)
				.send({ from:root });

			await truffleAssert.reverts(alkemiEarnVerified.methods
				.supply(OMG._address, 90)
				.send({ from: customer }));

		});
		
		it("returns error if accumulated balance calculation fails", async () => {
			const alkemiEarnVerifiedHarness =
				await AlkemiEarnVerifiedHarness.new().send({
					from: root,
				});
			await readAndExecContract(alkemiEarnVerifiedHarness, "initializer", [], {
				from: root,
			});
			const customer = accounts[1];
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeKYCAdmin",
				[root, true],
				{
					from: root,
				}
			);
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeCustomerKYC",
				[customer, true],
				{
					from: root,
				}
			);
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: root,
			});

			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, 100)
				.send({ gas: tokenTransferGas, from: root });

			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(alkemiEarnVerifiedHarness._address, 95)
				.send({ from: customer });

			await alkemiEarnVerifiedHarness.methods
				.harnessSetAssetPriceMantissa(
					OMG._address,
					getExpMantissa(0.5).toString(10)
				)
				.send({ from: root });
			await alkemiEarnVerifiedHarness.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: root });

			// Set zero as the previous supply index for the customer. This should cause div by zero error in balance calc.
			// To reach that we also have to set the previous principal to a non-zero value otherwise we will short circuit.
			await alkemiEarnVerifiedHarness.methods
				.harnessSetAccountSupplyBalance(customer, OMG._address, 1, 0)
				.send({ from: root });

			await alkemiEarnVerifiedHarness.methods
				.supply(OMG._address, 90)
				.send({ from: customer });
		});

		it("returns error if customer total new balance calculation fails", async () => {
			const alkemiEarnVerifiedHarness =
				await AlkemiEarnVerifiedHarness.new().send({
					from: root,
				});
			await readAndExecContract(alkemiEarnVerifiedHarness, "initializer", [], {
				from: root,
			});
			const customer = accounts[1];
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeKYCAdmin",
				[root, true],
				{
					from: root,
				}
			);
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeCustomerKYC",
				[customer, true],
				{
					from: root,
				}
			);
			const OMG = await EIP20.new(
				bigNums.maxUint.toString(10),
				"test omg",
				18,
				"omg"
			).send({
				from: root,
			});

			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, bigNums.maxUint.toString(10))
				.send({ gas: tokenTransferGas, from: root });

			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(
					alkemiEarnVerifiedHarness._address,
					bigNums.maxUint.toString(10)
				)
				.send({ from: customer });

			await alkemiEarnVerifiedHarness.methods
				.harnessSetAssetPriceMantissa(
					OMG._address,
					getExpMantissa(0.5).toString(10)
				)
				.send({ from: root });
			await alkemiEarnVerifiedHarness.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: root });

			await alkemiEarnVerifiedHarness.methods
				.harnessSetMarketDetails(OMG._address, 10, 0, 1, 0, 0, 1)
				.send({ from: root });

			// We are going to supply 1, so give an existing balance of maxUint to cause an overflow.
			await alkemiEarnVerifiedHarness.methods
				.harnessSetAccountSupplyBalance(
					customer,
					OMG._address,
					bigNums.maxUint.toString(10),
					1
				)
				.send({ from: root });

			await alkemiEarnVerifiedHarness.methods
				.supply(OMG._address, 1)
				.send({ from: customer });
		});

		it("returns error if protocol total supply calculation fails", async () => {
			const alkemiEarnVerifiedHarness =
				await AlkemiEarnVerifiedHarness.new().send({
					from: root,
				});
			await readAndExecContract(alkemiEarnVerifiedHarness, "initializer", [], {
				from: root,
			});
			const customer = accounts[1];
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeKYCAdmin",
				[root, true],
				{
					from: root,
				}
			);
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeCustomerKYC",
				[customer, true],
				{
					from: root,
				}
			);
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: root,
			});

			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, 100)
				.send({ gas: tokenTransferGas, from: root });

			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(alkemiEarnVerifiedHarness._address, 95)
				.send({ from: customer });

			await alkemiEarnVerifiedHarness.methods
				.harnessSetAssetPriceMantissa(
					OMG._address,
					getExpMantissa(0.5).toString(10)
				)
				.send({ from: root });
			await alkemiEarnVerifiedHarness.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: root });

			// Give the protocol a token balance of maxUint so when we calculate adding the new supply to it, it will overflow.
			await alkemiEarnVerifiedHarness.methods
				.harnessSetMarketDetails(
					OMG._address,
					bigNums.maxUint.toString(10),
					0,
					1,
					0,
					0,
					1
				)
				.send({ from: root });

			await alkemiEarnVerifiedHarness.methods
				.supply(OMG._address, 1)
				.send({ from: customer });
		});

		it("returns error if protocol total cash calculation fails", async () => {
			const alkemiEarnVerifiedHarness =
				await AlkemiEarnVerifiedHarness.new().send({
					from: root,
				});
			await readAndExecContract(alkemiEarnVerifiedHarness, "initializer", [], {
				from: root,
			});
			const customer = accounts[1];
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeKYCAdmin",
				[root, true],
				{
					from: root,
				}
			);
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeCustomerKYC",
				[customer, true],
				{
					from: root,
				}
			);
			const OMG = await EIP20.new(
				bigNums.maxUint.toString(10),
				"test omg",
				18,
				"omg"
			).send({
				from: root,
			});

			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, bigNums.maxUint.toString(10))
				.send({ gas: tokenTransferGas, from: root });

			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(
					alkemiEarnVerifiedHarness._address,
					bigNums.maxUint.toString(10)
				)
				.send({ from: customer });

			await alkemiEarnVerifiedHarness.methods
				.harnessSetAssetPriceMantissa(
					OMG._address,
					getExpMantissa(0.5).toString(10)
				)
				.send({ from: root });
			await alkemiEarnVerifiedHarness.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: root });

			await alkemiEarnVerifiedHarness.methods
				.harnessSetMarketDetails(OMG._address, 10, 0, 1, 0, 0, 1)
				.send({ from: root });

			// We are going to supply 1, so fake out protocol current cash as maxUint so when we add the new cash it will overflow.
			await alkemiEarnVerifiedHarness.methods
				.harnessSetCash(OMG._address, bigNums.maxUint.toString(10))
				.send({ from: root });

			await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.supply(OMG._address, 1)
				.send({ from: customer }));
		});
	});

	describe("withdraw", async () => {
		it("returns error and logs info if contract is paused", async () => {
			const alkemiEarnVerified = await AlkemiEarnVerifiedHarness.new().send({
				from: root,
			});
			await readAndExecContract(alkemiEarnVerified, "initializer", [], {
				from: root,
			});
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: root,
			});
			const customer = accounts[1];
		
			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, 100)
				.send({ gas: tokenTransferGas, from: root });
			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(alkemiEarnVerified._address, 95)
				.send({ from: root });

			await alkemiEarnVerified.methods
				._adminFunctions(root, root, true, 1000000000000000,0,root,root)
				.send({ from: root });

			await truffleAssert.reverts(alkemiEarnVerified.methods
				.withdraw(OMG._address, 90)
				.send({ from: root }));
		});

		it("returns error if new supply interest index calculation fails", async () => {
			const alkemiEarnVerified = await AlkemiEarnVerifiedHarness.new().send({
				from: root,
			});
			await readAndExecContract(alkemiEarnVerified, "initializer", [], {
				from: root,
			});

			const customer = accounts[1];
		
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: root,
			});

			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, 100)
				.send({ gas: tokenTransferGas, from: root });

			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(alkemiEarnVerified._address, 95)
				.send({ from: customer });

			await alkemiEarnVerified.methods
				.harnessSetAssetPriceMantissa(
					OMG._address,
					getExpMantissa(0.5).toString(10)
				)
				.send({ from: root });
			await alkemiEarnVerified.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: root });

			// Store a block number that should be HIGHER than the current block number so we'll get an underflow
			// when calculating block delta.
			await alkemiEarnVerified.methods
				.harnessSetMarketBlockNumber(OMG._address, -1)
				.send({ from:root });

			await truffleAssert.reverts(alkemiEarnVerified.methods
				.withdraw(OMG._address, 90)
				.send({ from: customer }));

		});

		it("returns error if protocol total borrow calculation fails", async () => {
			const alkemiEarnVerifiedHarness =
				await AlkemiEarnVerifiedHarness.new().send({
					from: root,
				});
			await readAndExecContract(alkemiEarnVerifiedHarness, "initializer", [], {
				from: root,
			});
			const customer = accounts[1];
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeKYCAdmin",
				[root, true],
				{
					from: root,
				}
			);
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeCustomerKYC",
				[customer, true],
				{
					from: root,
				}
			);
	
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: root,
			});
	
	
			// Support market
			await alkemiEarnVerifiedHarness.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: root });
	
			// Set price of OMG to 1:1
			await alkemiEarnVerifiedHarness.methods
				.harnessSetAssetPrice(OMG._address, 1, 1)
				.send({ from: root });
	
			// Clear out collateral ratio so user can borrow
			await alkemiEarnVerifiedHarness.methods
				.harnessSetCollateralRatio(0, 1)
				.send({ from: root });
	
			// Give the protocol a token balance of maxUint so when we calculate adding the new supply to it, it will overflow.
			await alkemiEarnVerifiedHarness.methods
				.harnessSetMarketDetails(
					OMG._address,
					0,
					0,
					1,
					bigNums.maxUint.toString(10),
					0,
					1
				)
				.send({ from: root });
	
			await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.withdraw(OMG._address, 1)
				.send({ from: customer }));
		});

		it("returns error if accumulated balance calculation fails", async () => {
			const alkemiEarnVerifiedHarness =
				await AlkemiEarnVerifiedHarness.new().send({
					from: root,
				});
			await readAndExecContract(alkemiEarnVerifiedHarness, "initializer", [], {
				from: root,
			});
			const customer = accounts[1];
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeKYCAdmin",
				[root, true],
				{
					from: root,
				}
			);
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeCustomerKYC",
				[customer, true],
				{
					from: root,
				}
			);
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: root,
			});

			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, 100)
				.send({ gas: tokenTransferGas, from: root });

			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(alkemiEarnVerifiedHarness._address, 95)
				.send({ from: customer });

			await alkemiEarnVerifiedHarness.methods
				.harnessSetAssetPriceMantissa(
					OMG._address,
					getExpMantissa(0.5).toString(10)
				)
				.send({ from: root });
			await alkemiEarnVerifiedHarness.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: root });

			// Set zero as the previous supply index for the customer. This should cause div by zero error in balance calc.
			// To reach that we also have to set the previous principal to a non-zero value otherwise we will short circuit.
			await alkemiEarnVerifiedHarness.methods
				.harnessSetAccountSupplyBalance(customer, OMG._address, 1, 0)
				.send({ from: root });

			await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.withdraw(OMG._address, 90)
				.send({ from: customer }));
		});

		it("reverts if token transfer fails", async () => {
			const alkemiEarnVerifiedHarness =
				await AlkemiEarnVerifiedHarness.new().send({
					from: root,
				});
			await readAndExecContract(alkemiEarnVerifiedHarness, "initializer", [], {
				from: root,
			});
			const customer = accounts[1];
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeKYCAdmin",
				[root, true],
				{
					from: root,
				}
			);
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeCustomerKYC",
				[customer, true],
				{
					from: root,
				}
			);
			const OMG = await EIP20.new(
				(10 ** 18).toString(10),
				"test omg ns",
				18,
				"omg"
			).send({ from: root });
			// Support market
			await alkemiEarnVerifiedHarness.methods
				.harnessSetAssetPriceMantissa(
					OMG._address,
					getExpMantissa(0.5).toString(10)
				)
				.send({ from: root });
			await alkemiEarnVerifiedHarness.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: root });
			// Give protocol cash
			await OMG.methods
				.harnessSetBalance(alkemiEarnVerifiedHarness._address, 100)
				.send({ from: root });

			await alkemiEarnVerifiedHarness.methods
				.harnessSetAccountSupplyBalance(customer, OMG._address, 100, 2)
				.send({ from: root });


			// Configure market state for OMG: a supply of 1000 and supply and borrow indexes of 1.
			await alkemiEarnVerifiedHarness.methods
				.harnessSetMarketDetails(OMG._address, 400, 100, 1, 1, 500, 100)
				.send({ from: root });

			// Use harness to set up a transfer out error
			await OMG.methods
				.harnessSetFailTransferToAddress(customer, true)
				.send({ from: root });

			await truffleAssert.reverts(
				alkemiEarnVerifiedHarness.methods
					.withdraw(OMG._address, 1)
					.send({ from: customer })
			);
		});

		it("returns error if protocol total cash calculation fails", async () => {
			const alkemiEarnVerifiedHarness =
				await AlkemiEarnVerifiedHarness.new().send({
					from: root,
				});
			await readAndExecContract(alkemiEarnVerifiedHarness, "initializer", [], {
				from: root,
			});
			const customer = accounts[1];
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeKYCAdmin",
				[root, true],
				{
					from: root,
				}
			);
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeCustomerKYC",
				[customer, true],
				{
					from: root,
				}
			);
			const OMG = await EIP20.new(
				bigNums.maxUint.toString(10),
				"test omg",
				18,
				"omg"
			).send({
				from: root,
			});

			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, bigNums.maxUint.toString(10))
				.send({ gas: tokenTransferGas, from: root });

			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(
					alkemiEarnVerifiedHarness._address,
					bigNums.maxUint.toString(10)
				)
				.send({ from: customer });

			await alkemiEarnVerifiedHarness.methods
				.harnessSetAssetPriceMantissa(
					OMG._address,
					getExpMantissa(0.5).toString(10)
				)
				.send({ from: root });
			await alkemiEarnVerifiedHarness.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: root });

			await alkemiEarnVerifiedHarness.methods
				.harnessSetMarketDetails(OMG._address, 10, 0, 1, 0, 0, 1)
				.send({ from: root });

			// We are going to supply 1, so fake out protocol current cash as maxUint so when we add the new cash it will overflow.
			await alkemiEarnVerifiedHarness.methods
				.harnessSetCash(OMG._address, bigNums.maxUint.toString(10))
				.send({ from: root });

			await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.withdraw(OMG._address, 1)
				.send({ from: customer }));
		});
	
	})

	describe("borrow", async () => {

		it("returns error and logs info if contract is paused", async () => {
			const alkemiEarnVerifiedHarness =
				await AlkemiEarnVerifiedHarness.new().send({
					from: root,
				});
			await readAndExecContract(alkemiEarnVerifiedHarness, "initializer", [], {
				from: root,
			});
			const customer = accounts[1];
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeKYCAdmin",
				[root, true],
				{
					from: root,
				}
			);
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeCustomerKYC",
				[customer, true],
				{
					from: root,
				}
			);
	
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: accounts[0],
			});
	
			await alkemiEarnVerifiedHarness.methods
				._adminFunctions(root, root, true, 1000000000000000,0,root,root)
				.send({ from: root });
	
			await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.borrow(OMG._address, 90)
				.send({ from: root }));
		});

		it("fails if market not supported", async () => {
			const alkemiEarnVerifiedHarness =
				await AlkemiEarnVerifiedHarness.new().send({
					from: root,
				});
			await readAndExecContract(alkemiEarnVerifiedHarness, "initializer", [], {
				from: root,
			});
			const customer = accounts[1];
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeKYCAdmin",
				[root, true],
				{
					from: root,
				}
			);
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeCustomerKYC",
				[customer, true],
				{
					from: root,
				}
			);
	
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: accounts[0],
			});
	
			await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.borrow(OMG._address, 90)
				.send({ from: customer }));
		});
	
		it("returns error if new supply interest index calculation fails", async () => {
			const alkemiEarnVerifiedHarness =
				await AlkemiEarnVerifiedHarness.new().send({
					from: root,
				});
			await readAndExecContract(alkemiEarnVerifiedHarness, "initializer", [], {
				from: root,
			});
			const customer = accounts[1];
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeKYCAdmin",
				[root, true],
				{
					from: root,
				}
			);
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeCustomerKYC",
				[customer, true],
				{
					from: root,
				}
			);
	
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: accounts[0],
			});
	
			// Support market
			await alkemiEarnVerifiedHarness.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: root });
	
			// Store a block number that should be HIGHER than the current block number so we'll get an underflow
			// when calculating block delta.
			await alkemiEarnVerifiedHarness.methods
				.harnessSetMarketBlockNumber(OMG._address, -1)
				.send({ from: root });
	
			await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.borrow(OMG._address, 90)
				.send({ from: customer }));
		});

		it("returns error if accumulated balance calculation fails", async () => {
			const alkemiEarnVerifiedHarness =
				await AlkemiEarnVerifiedHarness.new().send({
					from: root,
				});
			await readAndExecContract(alkemiEarnVerifiedHarness, "initializer", [], {
				from: root,
			});
			const customer = accounts[1];
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeKYCAdmin",
				[root, true],
				{
					from: root,
				}
			);
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeCustomerKYC",
				[customer, true],
				{
					from: root,
				}
			);
	
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: accounts[0],
			});
	
	
			// Support market
			await alkemiEarnVerifiedHarness.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: root });
	
			// Set zero as the previous supply index for the customer. This should cause div by zero error in balance calc.
			// To reach that we also have to set the previous principal to a non-zero value otherwise we will short circuit.
			await alkemiEarnVerifiedHarness.methods
				.harnessSetAccountBorrowBalance(customer, OMG._address, 1, 0)
				.send({ from: root });
	
			await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.borrow(OMG._address, 90)
				.send({ from: customer }));
		});
	
		it("returns error if customer total new balance calculation fails", async () => {
			const alkemiEarnVerifiedHarness =
				await AlkemiEarnVerifiedHarness.new().send({
					from: root,
				});
			await readAndExecContract(alkemiEarnVerifiedHarness, "initializer", [], {
				from: root,
			});
			const customer = accounts[1];
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeKYCAdmin",
				[root, true],
				{
					from: root,
				}
			);
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeCustomerKYC",
				[customer, true],
				{
					from: root,
				}
			);
	
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: root,
			});
	
			// Support market
			await alkemiEarnVerifiedHarness.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: root });
	
			// Set price of OMG to 1:1
			await alkemiEarnVerifiedHarness.methods
				.harnessSetAssetPrice(OMG._address, 1, 1)
				.send({ from: root });
	
			// Clear out collateral ratio so user can borrow
			await alkemiEarnVerifiedHarness.methods
				.harnessSetCollateralRatio(0, 1)
				.send({ from: root });
	
			// We are going to borrow 1, so give an existing balance of maxUint to cause an overflow.
			await alkemiEarnVerifiedHarness.methods
				.harnessSetAccountBorrowBalance(
					customer,
					OMG._address,
					bigNums.maxUint.toString(10),
					1
				)
				.send({ from: root });
	
			// Set market details
			await alkemiEarnVerifiedHarness.methods
				.harnessSetMarketDetails(OMG._address, 0, 0, 1, 0, 0, 1)
				.send({ from: root });
	
			await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.borrow(OMG._address, 1)
				.send({ from: customer }));
		});

		it("returns error if protocol total borrow calculation fails via underflow", async () => {
			const alkemiEarnVerifiedHarness =
				await AlkemiEarnVerifiedHarness.new().send({
					from: root,
				});
			await readAndExecContract(alkemiEarnVerifiedHarness, "initializer", [], {
				from: root,
			});
			const customer = accounts[1];
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeKYCAdmin",
				[root, true],
				{
					from: root,
				}
			);
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeCustomerKYC",
				[customer, true],
				{
					from: root,
				}
			);
	
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: root,
			});
	
			// Support market
			await alkemiEarnVerifiedHarness.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: root });
	
			// Set price of OMG to 1:1
			await alkemiEarnVerifiedHarness.methods
				.harnessSetAssetPrice(OMG._address, 1, 1)
				.send({ from: root });
	
			// Clear out collateral ratio so user can borrow
			await alkemiEarnVerifiedHarness.methods
				.harnessSetCollateralRatio(0, 1)
				.send({ from: root });
	
			// We are going to borrow 1, so give an existing balance of maxUint to cause an overflow.
			await alkemiEarnVerifiedHarness.methods
				.harnessSetAccountBorrowBalance(
					customer,
					OMG._address,
					bigNums.maxUint.toString(10),
					1
				)
				.send({ from: root });
	
			await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.borrow(OMG._address, 1)
				.send({ from: customer }));
		});
	
		it("returns error if protocol total borrow calculation fails", async () => {
			const alkemiEarnVerifiedHarness =
				await AlkemiEarnVerifiedHarness.new().send({
					from: root,
				});
			await readAndExecContract(alkemiEarnVerifiedHarness, "initializer", [], {
				from: root,
			});
			const customer = accounts[1];
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeKYCAdmin",
				[root, true],
				{
					from: root,
				}
			);
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeCustomerKYC",
				[customer, true],
				{
					from: root,
				}
			);
	
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: root,
			});
	
	
			// Support market
			await alkemiEarnVerifiedHarness.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: root });
	
			// Set price of OMG to 1:1
			await alkemiEarnVerifiedHarness.methods
				.harnessSetAssetPrice(OMG._address, 1, 1)
				.send({ from: root });
	
			// Clear out collateral ratio so user can borrow
			await alkemiEarnVerifiedHarness.methods
				.harnessSetCollateralRatio(0, 1)
				.send({ from: root });
	
			// Give the protocol a token balance of maxUint so when we calculate adding the new supply to it, it will overflow.
			await alkemiEarnVerifiedHarness.methods
				.harnessSetMarketDetails(
					OMG._address,
					0,
					0,
					1,
					bigNums.maxUint.toString(10),
					0,
					1
				)
				.send({ from: root });
	
			await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.borrow(OMG._address, 1)
				.send({ from: customer }));
		});
	
		it("returns error if protocol total cash calculation fails", async () => {
			const alkemiEarnVerifiedHarness =
				await AlkemiEarnVerifiedHarness.new().send({
					from: root,
				});
			await readAndExecContract(alkemiEarnVerifiedHarness, "initializer", [], {
				from: root,
			});
			const customer = accounts[1];
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeKYCAdmin",
				[root, true],
				{
					from: root,
				}
			);
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeCustomerKYC",
				[customer, true],
				{
					from: root,
				}
			);
	
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: root,
			});

			// Support market
			await alkemiEarnVerifiedHarness.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: root });
	
			// Set price of OMG to 1:1
			await alkemiEarnVerifiedHarness.methods
				.harnessSetAssetPrice(OMG._address, 1, 1)
				.send({ from: root });
	
			// Clear out collateral ratio so user can borrow
			await alkemiEarnVerifiedHarness.methods
				.harnessSetCollateralRatio(0, 1)
				.send({ from: root });
	
			// Give the protocol a token balance of maxUint so when we calculate adding the new supply to it, it will overflow.
			await alkemiEarnVerifiedHarness.methods
				.harnessSetMarketDetails(OMG._address, 0, 0, 1, 0, 0, 1)
				.send({ from: root });
	
			// We are going to borrow 1, so fake out protocol current cash as 0 so when we sub the new cash it will underflow.
			await alkemiEarnVerifiedHarness.methods
				.harnessSetCash(OMG._address, 0)
				.send({ from: root });
	
			await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.borrow(OMG._address, 1)
				.send({ from: customer }));
		});
	});

	describe("repayBorrow", async () => {
		it("returns error and logs info if contract is paused", async () => {
			const alkemiEarnVerifiedHarness =
				await AlkemiEarnVerifiedHarness.new().send({
					from: root,
				});
			await readAndExecContract(alkemiEarnVerifiedHarness, "initializer", [], {
				from: root,
			});
			const customer = accounts[1];
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeKYCAdmin",
				[root, true],
				{
					from: root,
				}
			);
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeCustomerKYC",
				[customer, true],
				{
					from: root,
				}
			);
	
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: root,
			});
	
			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, 100)
				.send({ gas: tokenTransferGas, from: root });
	
			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(alkemiEarnVerifiedHarness._address, 95)
				.send({ from: customer });
	
			await alkemiEarnVerifiedHarness.methods
				._adminFunctions(root, root, true, 1000000000000000,0,root,root)
				.send({ from: root });
	
			await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.repayBorrow(OMG._address, 90)
				.send({ from: customer }));
		});
	
		it("returns error if new borrow interest index calculation fails", async () => {
			const alkemiEarnVerifiedHarness =
				await AlkemiEarnVerifiedHarness.new().send({
					from: root,
				});
			await readAndExecContract(alkemiEarnVerifiedHarness, "initializer", [], {
				from: root,
			});
			const customer = accounts[1];
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeKYCAdmin",
				[root, true],
				{
					from: root,
				}
			);
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeCustomerKYC",
				[customer, true],
				{
					from: root,
				}
			);
	
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: root,
			});
	
			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, 100)
				.send({ gas: tokenTransferGas, from: root });
	
			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(alkemiEarnVerifiedHarness._address, 95)
				.send({ from: customer });
	
			// Store a block number that should be HIGHER than the current block number so we'll get an underflow
			// when calculating block delta.
			await alkemiEarnVerifiedHarness.methods
				.harnessSetMarketBlockNumber(OMG._address, -1)
				.send({ from: root });
	
			await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.repayBorrow(OMG._address, 90)
				.send({ from: customer }));
		});
	
		it("returns error if accumulated balance calculation fails", async () => {
			const alkemiEarnVerifiedHarness =
				await AlkemiEarnVerifiedHarness.new().send({
					from: root,
				});
			await readAndExecContract(alkemiEarnVerifiedHarness, "initializer", [], {
				from: root,
			});
			const customer = accounts[1];
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeKYCAdmin",
				[root, true],
				{
					from: root,
				}
			);
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeCustomerKYC",
				[customer, true],
				{
					from: root,
				}
			);
	
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: root,
			});
	
			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, 100)
				.send({ gas: tokenTransferGas, from: root });
	
			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(alkemiEarnVerifiedHarness._address, 95)
				.send({ from: customer });
	
			// Set zero as the previous borrow index for the customer. This should cause div by zero error in balance calc.
			// To reach that we also have to set the previous principal to a non-zero value otherwise we will short circuit.
			await alkemiEarnVerifiedHarness.methods
				.harnessSetAccountBorrowBalance(customer, OMG._address, 1, 0)
				.send({ from: root });
	
			await alkemiEarnVerifiedHarness.methods
				.repayBorrow(OMG._address, 90)
				.send({ from: customer });
		});
	
		it("returns error if customer total new balance calculation fails", async () => {
			const alkemiEarnVerifiedHarness =
				await AlkemiEarnVerifiedHarness.new().send({
					from: root,
				});
			await readAndExecContract(alkemiEarnVerifiedHarness, "initializer", [], {
				from: root,
			});
			const customer = accounts[1];
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeKYCAdmin",
				[root, true],
				{
					from: root,
				}
			);
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeCustomerKYC",
				[customer, true],
				{
					from: root,
				}
			);
	
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: root,
			});
	
			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, 100)
				.send({ gas: tokenTransferGas, from: root });
	
			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(alkemiEarnVerifiedHarness._address, 95)
				.send({ from: customer });
	
			// Set zero as the previous borrow index for the customer. This should cause div by zero error in balance calc.
			// To reach that we also have to set the previous principal to a non-zero value otherwise we will short circuit.
			await alkemiEarnVerifiedHarness.methods
				.harnessSetAccountBorrowBalance(customer, OMG._address, 0, 1)
				.send({ from: root });
	
			await alkemiEarnVerifiedHarness.methods
				.repayBorrow(OMG._address, 1)
				.send({ from: customer });
		});
	
		it("returns error if protocol total borrow calculation fails via overflow", async () => {
			const alkemiEarnVerifiedHarness =
				await AlkemiEarnVerifiedHarness.new().send({
					from: root,
				});
			await readAndExecContract(alkemiEarnVerifiedHarness, "initializer", [], {
				from: root,
			});
			const customer = accounts[1];
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeKYCAdmin",
				[root, true],
				{
					from: root,
				}
			);
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeCustomerKYC",
				[customer, true],
				{
					from: root,
				}
			);
	
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: root,
			});
	
			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, 100)
				.send({ gas: tokenTransferGas, from: root });
	
			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(alkemiEarnVerifiedHarness._address, 95)
				.send({ from: customer });
	
			// Give user some balance
			await alkemiEarnVerifiedHarness.methods
				.harnessSetAccountBorrowBalance(customer, OMG._address, 10, 1)
				.send({ from: root });
	
			// Give the protocol a token balance of 0 so when we calculate subtract the new borrow from it, it will underflow.
			await alkemiEarnVerifiedHarness.methods
				.harnessSetMarketDetails(OMG._address, 0, 0, 1, 0, 0, 1)
				.send({ from: root });
	
			await alkemiEarnVerifiedHarness.methods
				.repayBorrow(OMG._address, 1)
				.send({ from: customer });
		});
	
		it("returns error if protocol total cash calculation fails", async () => {
			const alkemiEarnVerifiedHarness =
				await AlkemiEarnVerifiedHarness.new().send({
					from: root,
				});
			await readAndExecContract(alkemiEarnVerifiedHarness, "initializer", [], {
				from: root,
			});
			const customer = accounts[1];
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeKYCAdmin",
				[root, true],
				{
					from: root,
				}
			);
			await readAndExecContract(
				alkemiEarnVerifiedHarness,
				"_changeCustomerKYC",
				[customer, true],
				{
					from: root,
				}
			);
	
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: root,
			});
	
			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, 100)
				.send({ gas: tokenTransferGas, from: root });
	
			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(alkemiEarnVerifiedHarness._address, 95)
				.send({ from: customer });
	
			// Set zero as the previous borrow index for the customer. This should cause div by zero error in balance calc.
			// To reach that we also have to set the previous principal to a non-zero value otherwise we will short circuit.
			await alkemiEarnVerifiedHarness.methods
				.harnessSetAccountBorrowBalance(customer, OMG._address, 10, 1)
				.send({ from: root });

			// Have sufficient borrows outstanding
			await alkemiEarnVerifiedHarness.methods
				.harnessSetMarketDetails(OMG._address, 0, 0, 1, 10, 0, 1)
				.send({ from: root });
	
			// We are going to pay borrow of 1, so fake out protocol current cash as maxUint so when we add the new cash it will overflow.
			await alkemiEarnVerifiedHarness.methods
				.harnessSetCash(OMG._address, bigNums.maxUint.toString(10))
				.send({ from: root });
	
			await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.repayBorrow(OMG._address, 1)
				.send({ from: customer }));
		});
	});



	describe("liquidateBorrow", async () => {
		it("returns error and logs info if contract is paused", async () => {
			const {
				alkemiEarnVerifiedHarness,
				borrower,
				liquidator,
				borrowed,
				collateral,
				supplyCollateralBlock,
				borrowBlock,
			} = await setupValidLiquidation();

			await alkemiEarnVerifiedHarness.methods
				._adminFunctions(root, root, true, 1000000000000000,0,root,root)
				.send({ from: root });

			await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.liquidateBorrow(borrower, borrowed._address, collateral._address, 6)
				.send({ from: liquidator }));
		});

	

		it("allows max for liquidation of 0", async () => {
			const {
				alkemiEarnVerifiedHarness,
				borrower,
				liquidator,
				borrowed,
				collateral,
				supplyCollateralBlock,
				borrowBlock,
			} = await setupValidLiquidation();

			// Make borrower's collateral more valuable so the borrow is not eligible for liquidation.
			// Set price of collateral to 4:1
			await alkemiEarnVerifiedHarness.methods
				.harnessSetAssetPrice(collateral._address, 4, 1)
				.send({ from: root });

			/////////// Call function. liquidate max by specifying -1
			const liquidateResult = await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.liquidateBorrow(borrower, borrowed._address, collateral._address, -1)
				.send({ from: liquidator }));

		
			// Liquidator's off-protocol token balance should have declined by the amount used to reduce the target user's borrow
			const liquidatorTokenBalance = await borrowed.methods
				.balanceOf(liquidator)
				.call();
		});

		it("handles unset price oracle", async () => {
			// We start with a valid setup then tweak as necessary to hit the desired error condition.
			const {
				alkemiEarnVerifiedHarness,
				borrower,
				liquidator,
				borrowed,
				collateral,
			} = await setupValidLiquidation();

			// SETUP DESIRED FAILURE:
			// Set current borrow interest index to maxUint so when we multiply by it we get an overflow
			await alkemiEarnVerifiedHarness.methods
				.harnessSetOracle("0x0000000000000000000000000000000000000000")
				.send({ from: root });
			await alkemiEarnVerifiedHarness.methods
				.harnessSetUseOracle(true)
				.send({ from: root });

			/////////// Call function
			const liquidateResult = await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.liquidateBorrow(borrower, borrowed._address, collateral._address, 1)
				.send({ from: liquidator }));

			await validateFailedLiquidation(
				liquidateResult,
				alkemiEarnVerifiedHarness,
				borrower,
				borrowed,
				collateral,
				liquidator
			);
		});

		it("fails with zero oracle price (borrowed)", async () => {
			// We start with a valid setup then tweak as necessary to hit the desired error condition.
			const {
				alkemiEarnVerifiedHarness,
				borrower,
				liquidator,
				borrowed,
				collateral,
			} = await setupValidLiquidation();

			// Set oracle price to zero for borrowed
			await alkemiEarnVerifiedHarness.methods
				.harnessSetAssetPriceMantissa(borrowed._address, 0)
				.send({ from: root });

			/////////// Call function
			const liquidateResult = await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.liquidateBorrow(borrower, borrowed._address, collateral._address, 1)
				.send({ from: liquidator }));

			await validateFailedLiquidation(
				liquidateResult,
				alkemiEarnVerifiedHarness,
				borrower,
				borrowed,
				collateral,
				liquidator
			);
		});

		it("fails with zero oracle price (collateral)", async () => {
			// We start with a valid setup then tweak as necessary to hit the desired error condition.
			const {
				alkemiEarnVerifiedHarness,
				borrower,
				liquidator,
				borrowed,
				collateral,
			} = await setupValidLiquidation();

			// Set oracle price to zero for borrowed
			await alkemiEarnVerifiedHarness.methods
				.harnessSetAssetPriceMantissa(collateral._address, 0)
				.send({ from: root });

			/////////// Call function
			const liquidateResult = await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.liquidateBorrow(borrower, borrowed._address, collateral._address, 1)
				.send({ from: liquidator }));

			await validateFailedLiquidation(
				liquidateResult,
				alkemiEarnVerifiedHarness,
				borrower,
				borrowed,
				collateral,
				liquidator
			);
		});
	
		it("handles failure to calculate discounted borrow-denominated shortfall", async () => {
			// We start with a valid setup then tweak as necessary to hit the desired error condition.
			const {
				alkemiEarnVerifiedHarness,
				borrower,
				liquidator,
				borrowed,
				collateral,
			} = await setupValidLiquidation();

			// SETUP DESIRED FAILURE:
			// Trigger a division by zero in `calculateDiscountedRepayToEvenAmount`:
			// Set price of borrowed to min exp and set a large liquidation discount.
			// Thus, the discounted price is zero and when we divide the shortfall by it, we get the error.
			// Note: We also have to set the collateral price low or we won't have anything eligible for liquidation.
			await alkemiEarnVerifiedHarness.methods
				.harnessSetAssetPrice(borrowed._address, 1, (10 ** 18).toString(10))
				.send({ from: root });
			await alkemiEarnVerifiedHarness.methods
				.harnessSetAssetPrice(collateral._address, 1, (10 ** 18).toString(10))
				.send({ from: root });
			await alkemiEarnVerifiedHarness.methods
				.harnessSetLiquidationDiscount("999000000000000000")
				.send({ from: root }); // .999

			/////////// Call function
			const result = await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.liquidateBorrow(borrower, borrowed._address, collateral._address, 1)
				.send({ from: liquidator }));

			await validateFailedLiquidation(
				result,
				alkemiEarnVerifiedHarness,
				borrower,
				borrowed,
				collateral,
				liquidator
			);
		});

		it("handles failure to calculate discounted borrow-denominated collateral", async () => {
			// We start with a valid setup then tweak as necessary to hit the desired error condition.
			const {
				alkemiEarnVerifiedHarness,
				borrower,
				liquidator,
				borrowed,
				collateral,
			} = await setupValidLiquidation();

			// SETUP DESIRED FAILURE:
			// use harness method to flag method for failure
			await alkemiEarnVerifiedHarness.methods
				.harnessSetFailBorrowDenominatedCollateralCalculation(true)
				.send({ from: root });

			/////////// Call function
			const result = await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.liquidateBorrow(borrower, borrowed._address, collateral._address, 1)
				.send({ from: liquidator }));

			await validateFailedLiquidation(
				result,
				alkemiEarnVerifiedHarness,
				borrower,
				borrowed,
				collateral,
				liquidator
			);
		});

		it("handles case of liquidator requesting to close too much of borrow", async () => {
			// We start with a valid setup then tweak as necessary to hit the desired error condition.
			const {
				alkemiEarnVerifiedHarness,
				borrower,
				liquidator,
				borrowed,
				collateral,
			} = await setupValidLiquidation();

			/////////// Call function with a requested amount that is too high
			const result = await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.liquidateBorrow(borrower, borrowed._address, collateral._address, 30)
				.send({ from: liquidator }));

			await validateFailedLiquidation(
				result,
				alkemiEarnVerifiedHarness,
				borrower,
				borrowed,
				collateral,
				liquidator
			);
		});

		it("handles failure to calculate amount of borrow to seize", async () => {
			// We start with a valid setup then tweak as necessary to hit the desired error condition.
			const {
				alkemiEarnVerifiedHarness,
				borrower,
				liquidator,
				borrowed,
				collateral,
			} = await setupValidLiquidation();

			// SETUP DESIRED FAILURE:
			// use harness method to flag method for failure
			await alkemiEarnVerifiedHarness.methods
				.harnessSetFailCalculateAmountSeize(true)
				.send({ from: root });

			/////////// Call function
			const result = await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.liquidateBorrow(borrower, borrowed._address, collateral._address, 1)
				.send({ from: liquidator }));

			await validateFailedLiquidation(
				result,
				alkemiEarnVerifiedHarness,
				borrower,
				borrowed,
				collateral,
				liquidator
			);
		});

	

		

		it("handles failure to calculate new total cash for the borrowed asset", async () => {
			// We start with a valid setup then tweak as necessary to hit the desired error condition.
			const {
				alkemiEarnVerifiedHarness,
				borrower,
				liquidator,
				borrowed,
				collateral,
			} = await setupValidLiquidation();

			// SETUP DESIRED FAILURE:
			// We are going to repay 1, so fake out protocol current cash as maxUint so when we add the new cash it will overflow.
			await alkemiEarnVerifiedHarness.methods
				.harnessSetCash(borrowed._address, bigNums.maxUint.toString(10))
				.send({ from: root });

			/////////// Call function
			const result = await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.liquidateBorrow(borrower, borrowed._address, collateral._address, 1)
				.send({ from: liquidator }));

			await validateFailedLiquidation(
				result,
				alkemiEarnVerifiedHarness,
				borrower,
				borrowed,
				collateral,
				liquidator
			);
		});

		it("handles liquidator failure to approve borrowed asset for transfer in to protocol", async () => {
			// We start with a valid setup then tweak as necessary to hit the desired error condition.
			const {
				alkemiEarnVerifiedHarness,
				borrower,
				liquidator,
				borrowed,
				collateral,
			} = await setupValidLiquidation();

			// SETUP DESIRED FAILURE:
			// remove liquidator's approval for borrowed asset
			await borrowed.methods
				.approve(alkemiEarnVerifiedHarness._address, 0)
				.send({ from: liquidator });

			/////////// Call function
			const result = await truffleAssert.reverts(alkemiEarnVerifiedHarness.methods
				.liquidateBorrow(borrower, borrowed._address, collateral._address, 1)
				.send({ from: liquidator }));

			await validateFailedLiquidation(
				result,
				alkemiEarnVerifiedHarness,
				borrower,
				borrowed,
				collateral,
				liquidator
			);
		});
	});
});
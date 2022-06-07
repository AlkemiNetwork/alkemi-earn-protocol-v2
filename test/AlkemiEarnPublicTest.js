const { getContract, readAndExecContract } = require("./Contract");
const { getExpMantissa, bigNums } = require("./Utils");
const AlkemiEarnPublic = getContract("./AlkemiEarnPublic.sol");
const EIP20 = getContract("./test/EIP20Harness.sol");
const PriceOracle = getContract("./test/PriceOracleHarness.sol");
const StandardInterestRateModel = getContract("./AlkemiRateModel.sol");
const AlkemiEarnPublicHarness = getContract("./test/AlkemiEarnPublicHarness.sol");
const StandardInterestRateModel1 = getContract("./InterestRateModel/FixedInterestRateModel.sol");
const truffleAssert = require('truffle-assertions');

const addressZero = "0x0000000000000000000000000000000000000000";

contract('AlkemiEarnPublic', (accounts) => {
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
		const alkemiEarnPublic =
			await AlkemiEarnPublicHarness.new().send({
				from: accounts[0],
			});
		await readAndExecContract(alkemiEarnPublic, "initializer", [], {
			from: accounts[0],
		});
		
		const priceOracle = await PriceOracle.new().send({ from: accounts[0] });
		await alkemiEarnPublic.methods
			._adminFunctions(accounts[0], priceOracle._address, false, 1000000000000000,0)
			.send({ from: accounts[0] });
		// Set up SimpleInterestRateModel for collateral and borrowed market. borrow rate is 50% per block
		const simpleInterestRateModel = await StandardInterestRateModel1
		.new(1, 5).send({from: accounts[0]});
		

		const collateral = await EIP20.new(
			liquidationSetup.totalTokenAmount,
			"test omg",
			18,
			"omg"
		).send({ from: accounts[0] });
		const borrowed = await EIP20.new(
			liquidationSetup.totalTokenAmount,
			"test drgn",
			18,
			"drgn"
		).send({ from: accounts[0] });
		const price = getExpMantissa(0.0075);
			await priceOracle.methods
				.harnessSetAssetPrice(collateral._address, price)
				.send({ from: accounts[0] });
			await priceOracle.methods
				.harnessSetAssetPrice(borrowed._address, price)
				.send({ from: accounts[0] });

		await alkemiEarnPublic.methods
			.harnessSupportMarket(collateral._address)
			.send({ from: accounts[0] });
		await alkemiEarnPublic.methods
			.harnessSupportMarket(borrowed._address)
			.send({ from: accounts[0] });

		// Add collateral market for omg & drgn
		await alkemiEarnPublic.methods
			.harnessAddCollateralMarket(collateral._address)
			.send({ from: accounts[0] });
		await alkemiEarnPublic.methods
			.harnessAddCollateralMarket(borrowed._address)
			.send({ from: accounts[0] });
		

		await alkemiEarnPublic.methods
			._supportMarket(collateral._address, simpleInterestRateModel._address)
			.send({ from: accounts[0] });
		await alkemiEarnPublic.methods
			._supportMarket(borrowed._address, simpleInterestRateModel._address)
			.send({ from: accounts[0] });

		// Set a required collateral ratio of 2:1
		await alkemiEarnPublic.methods
			.harnessSetCollateralRatio(2, 1)
			.send({ from: accounts[0] });

		// Give liquidator an approved balance of the borrowed token, borrowed, so he can repay part of the underwater loan
		await borrowed.methods
			.transfer(liquidator, liquidationSetup.initialTokenBalanceLiquidator)
			.send({ gas: tokenTransferGas, from: accounts[0] });
		await borrowed.methods
			.approve(
				alkemiEarnPublic._address,
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
			.send({ from: accounts[0] });
		await borrowed.methods
			.approve(
				alkemiEarnPublic._address,
				liquidationSetup.initialTokenBalanceOtherSupplier
			)
			.send({ from: otherSupplier });
		const deliverBorrowAssetResult = await alkemiEarnPublic.methods
			.supply(
				borrowed._address,
				liquidationSetup.initialTokenBalanceOtherSupplier
			)
			.send({ from: otherSupplier });

		// Give borrower some collateral and supply it to compound
		await collateral.methods
			.transfer(borrower, liquidationSetup.initialCollateralAmount)
			.send({ from: accounts[0] });
		await collateral.methods
			.approve(
				alkemiEarnPublic._address,
				liquidationSetup.initialCollateralAmount
			)
			.send({ from: borrower });
		await alkemiEarnPublic.methods
			.supply(collateral._address, liquidationSetup.initialCollateralAmount)
			.send({ from: borrower });	

		// Create the borrow
		await truffleAssert.reverts(alkemiEarnPublic.methods
			.borrow(borrowed._address, liquidationSetup.initialBorrowAmount)
			.send({ from: borrower }));
		// Track and return this so callers can accurately calculate accrued interest on the borrow if they so desire.
		const borrowBlock = 1234564;
		const supplyCollateralBlock = 1234569;


		return {
			borrower: borrower,
			liquidator: liquidator,
			alkemiEarnPublic: alkemiEarnPublic,
			collateral: collateral,
			borrowed: borrowed,
			supplyCollateralBlock: supplyCollateralBlock,
			borrowBlock: borrowBlock,
		};
	}

	// Validates info from `setupValidLiquidation` given that the liquidation did NOT occur.
	async function validateFailedLiquidation(
		result,
		alkemiEarnPublic,
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
		const liquidatorCollateralBalance = await alkemiEarnPublic.methods
			.getSupplyBalance(liquidator, collateral._address)
			.call();

		const borrowerBorrowBalance = await alkemiEarnPublic.methods
			.getBorrowBalance(borrower, borrowed._address)
			.call();

		const borrowerCollateralBalance = await alkemiEarnPublic.methods
			.getSupplyBalance(borrower, collateral._address)
			.call();
	}
	describe("admin / _setPendingAdmin", async () => {
		it("admin is initially set to root and pendingAdmin is 0", async () => {
			const alkemiEarnPublic = await AlkemiEarnPublic.new().send({
				from: accounts[0],
			});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			assert.matchesAddress(
				accounts[0],
				await alkemiEarnPublic.methods.admin().call()
			);
			assert.equal(
				addressZero,
				await alkemiEarnPublic.methods.pendingAdmin().call(),
				"pendingAdmin should be zero for a new contract"
			);
		});

		it("can be used by admin", async () => {
			const alkemiEarnPublic = await AlkemiEarnPublic.new().send({
				from: accounts[0],
			});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			await readAndExecContract(

				alkemiEarnPublic,
				"_adminFunctions",
				[accounts[1], accounts[0], false, 1000000000000000,0],
				{ from: accounts[0] }
			);
			assert.matchesAddress(
				accounts[1],
				await alkemiEarnPublic.methods.pendingAdmin().call()
			);
			assert.matchesAddress(
				accounts[0],
				await alkemiEarnPublic.methods.admin().call()
			);
		});
	});

	describe("priceOracle / _setOracle", async () => {
		it("is initially unset", async () => {
			const alkemiEarnPublic = await AlkemiEarnPublic.new().send({
				from: accounts[0],
			});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			assert.matchesAddress(
				addressZero,
				await alkemiEarnPublic.methods.priceOracle().call()
			);
		});

		it("it can be changed by admin", async () => {
			const alkemiEarnPublic = await AlkemiEarnPublic.new().send({
				from: accounts[0],
			});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			const priceOracle = await PriceOracle.new().send({ from: accounts[0] });
			await readAndExecContract(
				alkemiEarnPublic,
				"_adminFunctions",
				[accounts[0], priceOracle._address, false, 1000000000000000,0],
				{ from: accounts[0] }
			);
			assert.matchesAddress(
				priceOracle._address,
				await alkemiEarnPublic.methods.priceOracle().call()
			);
		});
	});

	describe("_setPaused", async () => {
		it("contract is not paused when created", async () => {
			const alkemiEarnPublic = await AlkemiEarnPublic.new().send({
				from: accounts[0],
			});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});

			const paused = await alkemiEarnPublic.methods.paused().call();
			assert.equal(
				paused,
				false,
				"newly-created contract should not be paused"
			);
		});

		it("changes state when requested by admin", async () => {
			const alkemiEarnPublic = await AlkemiEarnPublic.new().send({
				from: accounts[0],
			});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});

			await readAndExecContract(
				alkemiEarnPublic,
				"_adminFunctions",
				[accounts[0], accounts[0], true, 1000000000000000,0],
				{ from: accounts[0], gas: 1000000 }
			);

			const paused = await alkemiEarnPublic.methods.paused().call();
			assert.equal(paused, true, "contract should be paused");

			await readAndExecContract(
				alkemiEarnPublic,
				"_adminFunctions",
				[accounts[0], accounts[0], false, 1000000000000000,0],
				{ from: accounts[0], gas: 1000000 }
			);
		});

		it("accepts non-state change", async () => {
			const alkemiEarnPublic = await AlkemiEarnPublic.new().send({
				from: accounts[0],
			});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});

			await readAndExecContract(
				alkemiEarnPublic,
				"_adminFunctions",
				[accounts[0], accounts[0], false, 1000000000000000,0],
				{ from: accounts[0], gas: 1000000 }
			);

			const paused = await alkemiEarnPublic.methods.paused().call();
			assert.equal(paused, false, "contract should not be paused");

		});
	});

	describe("setWethAddress", async () => {
		it("is initially unset", async () => {
			const alkemiEarnPublic = await AlkemiEarnPublic.new().send({
				from: accounts[0],
			});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});

			assert.matchesAddress(
				addressZero,
				await alkemiEarnPublic.methods.wethAddress().call(),
			);
		});

		it("changes state when requested by admin", async () => {
			const alkemiEarnPublic = await AlkemiEarnPublic.new().send({
				from: accounts[0],
			});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			const WETH = await EIP20.new(
				(10 ** 18).toString(),
				"test eth",
				18,
				"eth"
			).send({
				from: accounts[0],
			});
			await alkemiEarnPublic.methods
				.setWethAddress(WETH._address)
				.send({ from: accounts[0], gas: 1000000 });

			assert.matchesAddress(
				WETH._address,
				await alkemiEarnPublic.methods.wethAddress().call()
				);
		});
	});

	describe("assetPrices", async () => {
		it("returns scaled price when available", async () => {
			const alkemiEarnPublic = await AlkemiEarnPublic.new().send({
				from: accounts[0],
			});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			const priceOracle = await PriceOracle.new().send({ from: accounts[0] });
			await alkemiEarnPublic.methods
				._adminFunctions(accounts[0], priceOracle._address, false, 1000000000000000,0)
				.send({ from: accounts[0] });
			const OMG = await EIP20.new(
				(10 ** 18).toString(),
				"test omg",
				18,
				"omg"
			).send({
				from: accounts[0],
			});

			const price = getExpMantissa(0.0075);
			await priceOracle.methods
				.harnessSetAssetPrice(OMG._address, price)
				.send({ from: accounts[0] });

			const result = await alkemiEarnPublic.methods
				.assetPrices(OMG._address)
				.call();
			assert.equal(result, price, "OMG price");
		});

		it("returns 0 when price not available", async () => {
			const alkemiEarnPublic = await AlkemiEarnPublic.new().send({
				from: accounts[0],
			});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			const priceOracle = await PriceOracle.new().send({ from: accounts[0] });
			await alkemiEarnPublic.methods
				._adminFunctions(accounts[0], priceOracle._address, false, 1000000000000000,0)
				.send({ from: accounts[0] });
			const OMG = await EIP20.new(
				(10 ** 18).toString(),
				"test omg",
				18,
				"omg"
			).send({
				from: accounts[0],
			});

			const result = await alkemiEarnPublic.methods
				.assetPrices(OMG._address)
				.call();
			assert.equal(result, 0, "OMG should have no price");
		});
	});

	describe("_supportMarket / _suspendMarket", async () => {
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
		it("can be set by admin given collateral market < 16 and price oracle is set", async () => {
			const alkemiEarnPublic = await AlkemiEarnPublic.new().send({
				from: accounts[0],
			});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			const priceOracle = await PriceOracle.new().send({ from: accounts[0] });
			await alkemiEarnPublic.methods
				._adminFunctions(accounts[0], priceOracle._address, false, 1000000000000000,0)
				.send({ from: accounts[0] });
			const OMG = await EIP20.new(
				(10 ** 18).toString(),
				"test omg",
				18,
				"omg"
			).send({
				from: accounts[0],
			});

			const price = getExpMantissa(0.0075);
			await priceOracle.methods
				.harnessSetAssetPrice(OMG._address, price)
				.send({ from: accounts[0] });
			await alkemiEarnPublic.methods
				._supportMarket(OMG._address, standardInterestRateModel._address)
				.send({ from: accounts[0] });
			await alkemiEarnPublic.methods
				._suspendMarket(OMG._address)
				.send({ from: accounts[0] });
		});
	});

	describe("_withdrawEquity", async () => {

		it("fails if amount requested exceeds equity", async () => {
			const alkemiEarnPublic = await AlkemiEarnPublicHarness.new().send({
				from: accounts[0],
			});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: accounts[0],
			});
			const asset = OMG._address;

			// Give protocol cash
			await OMG.methods
				.harnessSetBalance(alkemiEarnPublic._address, 10000)
				.send({ from: accounts[0] });

			// Configure market state for OMG: a supply of 1000, borrows of 2000 and supply and borrow indexes of 1.
			await alkemiEarnPublic.methods
				.harnessSetMarketDetails(OMG._address, 1000, 0, 1, 2000, 0, 1)
				.send({ from: accounts[0] });

			// equity = 10000 + 2000 - 1000 = 11000. Try to withdraw more than equity and should be rejected
			await truffleAssert.reverts(alkemiEarnPublic.methods
				._withdrawEquity(asset, 11001)
				.send({ from: accounts[0], gas: 1000000 }));
		});

		it("fails if cash + borrows overflows", async () => {
			const alkemiEarnPublic = await AlkemiEarnPublicHarness.new().send({
				from: accounts[0],
			});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: accounts[0],
			});
			const asset = OMG._address;

			// Give protocol cash
			await OMG.methods
				.harnessSetBalance(alkemiEarnPublic._address, 10000)
				.send({ from: accounts[0] });

			// Configure market state for OMG: a supply of 1, borrows of maxUint and supply and borrow indexes of 1.
			await alkemiEarnPublic.methods
				.harnessSetMarketDetails(
					OMG._address,
					1,
					0,
					1,
					bigNums.maxUint.toString(10),
					0,
					1
				)
				.send({ from: accounts[0] });

			// cash of 1000 + borrows of maxUint should overflow
			await truffleAssert.reverts(alkemiEarnPublic.methods
				._withdrawEquity(asset, 10)
				.send({ from: accounts[0], gas: 1000000 }));

		});

		it("fails if cash + borrows - supply underflows", async () => {
			const alkemiEarnPublic = await AlkemiEarnPublicHarness.new().send({
				from: accounts[0],
			});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: accounts[0],
			});
			const asset = OMG._address;

			// Give protocol cash
			await OMG.methods
				.harnessSetBalance(alkemiEarnPublic._address, 10000)
				.send({ from: accounts[0] });

			// Configure market state for OMG: a supply of maxUint, borrows of 0 and supply and borrow indexes of 1.
			await alkemiEarnPublic.methods
				.harnessSetMarketDetails(
					OMG._address,
					bigNums.maxUint.toString(10),
					0,
					1,
					0,
					0,
					1
				)
				.send({ from: accounts[0] });

			// cash of 1000 + 0 borrows - maxUint should underflow
			await truffleAssert.reverts(alkemiEarnPublic.methods
				._withdrawEquity(asset, 10)
				.send({ from: accounts[0], gas: 1000000 }));
		});

		it("fails if transfer out fails", async () => {
			const alkemiEarnPublic = await AlkemiEarnPublicHarness.new().send({
				from: accounts[0],
			});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: accounts[0],
			});
			const asset = OMG._address;

			// Give protocol cash
			await OMG.methods
				.harnessSetBalance(alkemiEarnPublic._address, 10000)
				.send({ from: accounts[0] });

			// Configure market state for OMG: a supply of 1000, borrows of 2000 and supply and borrow indexes of 1.
			await alkemiEarnPublic.methods
				.harnessSetMarketDetails(OMG._address, 1000, 0, 1, 2000, 0, 1)
				.send({ from: accounts[0] });

			await OMG.methods
				.harnessSetFailTransferToAddress(accounts[0], true)
				.send({ from: accounts[0] });

			// equity = 10000 - (1000 + 2000) = 7000. Try to withdraw only 4500, which should be allowed
			// BUT we have configured the token harness to fail the transfer out
			await truffleAssert.reverts(alkemiEarnPublic.methods
				._withdrawEquity(asset, 10)
				.send({ from: accounts[0], gas: 1000000 }));
		});

		it("emits log on success", async () => {
			const alkemiEarnPublic = await AlkemiEarnPublicHarness.new().send({
				from: accounts[0],
			});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: accounts[0],
			});
			const asset = OMG._address;

			// Give protocol cash
			await OMG.methods
				.harnessSetBalance(alkemiEarnPublic._address, 10000)
				.send({ from: accounts[0] });

			// Configure market state for OMG: a supply of 1000, borrows of 2000 and supply and borrow indexes of 1.
			await alkemiEarnPublic.methods
				.harnessSetMarketDetails(OMG._address, 1000, 0, 1, 2000, 0, 1)
				.send({ from: accounts[0] });

			// equity = 10000 + 2000 - 1000 = 11000. Try to withdraw only 4500, which should be allowed
			 await readAndExecContract(
				alkemiEarnPublic,
				"_withdrawEquity",
				[asset, 4500],
				{ from: accounts[0], gas: 1000000 }
			);
		});
	});

	describe("harnessCalculateInterestIndex", async () => {
		it("calculates correct value for exact value", async () => {
			const alkemiEarnPublic =
				await AlkemiEarnPublicHarness.new().send({
					from: accounts[0],
				});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});

			assert.equal(
				6e18,
				Number(
					await alkemiEarnPublic.methods
						.harnessCalculateInterestIndex((1e18).toString(10), 1000, 50)
						.call()
				)
			);
		});

		it("calculates correct value for inexact value", async () => {
			const alkemiEarnPublic =
				await AlkemiEarnPublicHarness.new().send({
					from: accounts[0],
				});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});

			// 111111111111111111 * ( 1 + 9 * 0.0001)
			assert.withinPercentage(
				111211111111111089,
				Number(
					await alkemiEarnPublic.methods
						.harnessCalculateInterestIndex("111111111111111111", 1, 9)
						.call()
				),
				1e-10
			);
		});
	});

	describe("supply", async () => {
		it("returns error and logs info if contract is paused", async () => {
			const alkemiEarnPublic =
				await AlkemiEarnPublicHarness.new().send({
					from: accounts[0],
				});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			const customer = accounts[1];
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: accounts[0],
			});

			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, 100)
				.send({ gas: tokenTransferGas, from: accounts[0] });
			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(alkemiEarnPublic._address, 95)
				.send({ from: customer });

			await alkemiEarnPublic.methods
				._adminFunctions(accounts[0], accounts[0], true, 1000000000000000,0)
				.send({ from: accounts[0] });

			await truffleAssert.reverts(alkemiEarnPublic.methods
				.supply(OMG._address, 90)
				.send({ from: customer }));
		});

		it("returns error if new supply interest index calculation fails", async () => {
			const alkemiEarnPublic =
				await AlkemiEarnPublicHarness.new().send({
					from: accounts[0],
				});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			const customer = accounts[1];
		
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: accounts[0],
			});

			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, 100)
				.send({ gas: tokenTransferGas, from: accounts[0] });

			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(alkemiEarnPublic._address, 95)
				.send({ from: customer });

			await alkemiEarnPublic.methods
				.harnessSetAssetPriceMantissa(
					OMG._address,
					getExpMantissa(0.5).toString(10)
				)
				.send({ from: accounts[0] });
			await alkemiEarnPublic.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: accounts[0] });

			// Store a block number that should be HIGHER than the current block number so we'll get an underflow
			// when calculating block delta.
			await alkemiEarnPublic.methods
				.harnessSetMarketBlockNumber(OMG._address, -1)
				.send({ from: accounts[0] });

			await truffleAssert.reverts(alkemiEarnPublic.methods
				.supply(OMG._address, 90)
				.send({ from: customer }));

		});

		it("returns error if accumulated balance calculation fails", async () => {
			const alkemiEarnPublic =
				await AlkemiEarnPublicHarness.new().send({
					from: accounts[0],
				});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			const customer = accounts[1];

			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: accounts[0],
			});

			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, 100)
				.send({ gas: tokenTransferGas, from: accounts[0] });

			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(alkemiEarnPublic._address, 95)
				.send({ from: customer });

			await alkemiEarnPublic.methods
				.harnessSetAssetPriceMantissa(
					OMG._address,
					getExpMantissa(0.5).toString(10)
				)
				.send({ from: accounts[0] });
			await alkemiEarnPublic.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: accounts[0] });

			// Set zero as the previous supply index for the customer. This should cause div by zero error in balance calc.
			// To reach that we also have to set the previous principal to a non-zero value otherwise we will short circuit.
			await alkemiEarnPublic.methods
				.harnessSetAccountSupplyBalance(customer, OMG._address, 1, 0)
				.send({ from: accounts[0] });

			await alkemiEarnPublic.methods
				.supply(OMG._address, 90)
				.send({ from: customer });
		});

		it("returns error if customer total new balance calculation fails", async () => {
			const alkemiEarnPublic =
				await AlkemiEarnPublicHarness.new().send({
					from: accounts[0],
				});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			const customer = accounts[1];

			const OMG = await EIP20.new(
				bigNums.maxUint.toString(10),
				"test omg",
				18,
				"omg"
			).send({
				from: accounts[0],
			});

			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, bigNums.maxUint.toString(10))
				.send({ gas: tokenTransferGas, from: accounts[0] });

			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(
					alkemiEarnPublic._address,
					bigNums.maxUint.toString(10)
				)
				.send({ from: customer });

			await alkemiEarnPublic.methods
				.harnessSetAssetPriceMantissa(
					OMG._address,
					getExpMantissa(0.5).toString(10)
				)
				.send({ from: accounts[0] });
			await alkemiEarnPublic.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: accounts[0] });

			await alkemiEarnPublic.methods
				.harnessSetMarketDetails(OMG._address, 10, 0, 1, 0, 0, 1)
				.send({ from: accounts[0] });

			// We are going to supply 1, so give an existing balance of maxUint to cause an overflow.
			await alkemiEarnPublic.methods
				.harnessSetAccountSupplyBalance(
					customer,
					OMG._address,
					bigNums.maxUint.toString(10),
					1
				)
				.send({ from: accounts[0] });

			await alkemiEarnPublic.methods
				.supply(OMG._address, 1)
				.send({ from: customer });

		});

		it("returns error if protocol total supply calculation fails", async () => {
			const alkemiEarnPublic =
				await AlkemiEarnPublicHarness.new().send({
					from: accounts[0],
				});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			const customer = accounts[1];

			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: accounts[0],
			});

			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, 100)
				.send({ gas: tokenTransferGas, from: accounts[0] });

			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(alkemiEarnPublic._address, 95)
				.send({ from: customer });

			await alkemiEarnPublic.methods
				.harnessSetAssetPriceMantissa(
					OMG._address,
					getExpMantissa(0.5).toString(10)
				)
				.send({ from: accounts[0] });
			await alkemiEarnPublic.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: accounts[0] });

			// Give the protocol a token balance of maxUint so when we calculate adding the new supply to it, it will overflow.
			await alkemiEarnPublic.methods
				.harnessSetMarketDetails(
					OMG._address,
					bigNums.maxUint.toString(10),
					0,
					1,
					0,
					0,
					1
				)
				.send({ from: accounts[0] });

			await alkemiEarnPublic.methods
				.supply(OMG._address, 1)
				.send({ from: customer });
		});

		it("returns error if protocol total cash calculation fails", async () => {
			const alkemiEarnPublic =
				await AlkemiEarnPublicHarness.new().send({
					from: accounts[0],
				});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			const customer = accounts[1];

			const OMG = await EIP20.new(
				bigNums.maxUint.toString(10),
				"test omg",
				18,
				"omg"
			).send({
				from: accounts[0],
			});

			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, bigNums.maxUint.toString(10))
				.send({ gas: tokenTransferGas, from: accounts[0] });

			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(
					alkemiEarnPublic._address,
					bigNums.maxUint.toString(10)
				)
				.send({ from: customer });

			await alkemiEarnPublic.methods
				.harnessSetAssetPriceMantissa(
					OMG._address,
					getExpMantissa(0.5).toString(10)
				)
				.send({ from: accounts[0] });
			await alkemiEarnPublic.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: accounts[0] });

			await alkemiEarnPublic.methods
				.harnessSetMarketDetails(OMG._address, 10, 0, 1, 0, 0, 1)
				.send({ from: accounts[0] });

			// We are going to supply 1, so fake out protocol current cash as maxUint so when we add the new cash it will overflow.
			await alkemiEarnPublic.methods
				.harnessSetCash(OMG._address, bigNums.maxUint.toString(10))
				.send({ from: accounts[0] });

			await truffleAssert.reverts(alkemiEarnPublic.methods
				.supply(OMG._address, 1)
				.send({ from: customer }));
		});
	});
	
	describe("withdraw", async () => {
		it("returns error and logs info if contract is paused", async () => {
			const alkemiEarnPublic = await AlkemiEarnPublic.new().send({
				from: accounts[0],
			});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: accounts[0],
			});
			const customer = accounts[1];
		
			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, 100)
				.send({ gas: tokenTransferGas, from: accounts[0] });
			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(alkemiEarnPublic._address, 95)
				.send({ from: accounts[0] });

			await alkemiEarnPublic.methods
				._adminFunctions(accounts[0], accounts[0], true, 1000000000000000,0)
				.send({ from: accounts[0] });

			await truffleAssert.reverts(alkemiEarnPublic.methods
				.withdraw(OMG._address, 90)
				.send({ from: accounts[0] }));
		});

		it("returns error if new supply interest index calculation fails", async () => {
			const alkemiEarnPublic =
				await AlkemiEarnPublicHarness.new().send({
					from: accounts[0],
				});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			const customer = accounts[1];
		
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: accounts[0],
			});

			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, 100)
				.send({ gas: tokenTransferGas, from: accounts[0] });

			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(alkemiEarnPublic._address, 95)
				.send({ from: customer });

			await alkemiEarnPublic.methods
				.harnessSetAssetPriceMantissa(
					OMG._address,
					getExpMantissa(0.5).toString(10)
				)
				.send({ from: accounts[0] });
			await alkemiEarnPublic.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: accounts[0] });

			// Store a block number that should be HIGHER than the current block number so we'll get an underflow
			// when calculating block delta.
			await alkemiEarnPublic.methods
				.harnessSetMarketBlockNumber(OMG._address, -1)
				.send({ from: accounts[0] });

			await truffleAssert.reverts(alkemiEarnPublic.methods
				.withdraw(OMG._address, 90)
				.send({ from: customer }));

		});

		it("returns error if protocol total borrow calculation fails", async () => {
			const alkemiEarnPublic =
				await AlkemiEarnPublicHarness.new().send({
					from: accounts[0],
				});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			const customer = accounts[1];
		
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: accounts[0],
			});

			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, 100)
				.send({ gas: tokenTransferGas, from: accounts[0] });

			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(alkemiEarnPublic._address, 95)
				.send({ from: customer });

			await alkemiEarnPublic.methods
				.harnessSetAssetPriceMantissa(
					OMG._address,
					getExpMantissa(0.5).toString(10)
				)
				.send({ from: accounts[0] });
			await alkemiEarnPublic.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: accounts[0] });
	
			// Clear out collateral ratio so user can borrow
			await alkemiEarnPublic.methods
				.harnessSetCollateralRatio(0, 1)
				.send({ from: accounts[0] });
	
			// Give the protocol a token balance of maxUint so when we calculate adding the new supply to it, it will overflow.
			await alkemiEarnPublic.methods
				.harnessSetMarketDetails(
					OMG._address,
					0,
					0,
					1,
					bigNums.maxUint.toString(10),
					0,
					1
				)
				.send({ from: accounts[0] });
	
			await truffleAssert.reverts(alkemiEarnPublic.methods
				.withdraw(OMG._address, 1)
				.send({ from: customer }));
		});

		it("returns error if accumulated balance calculation fails", async () => {
			const alkemiEarnPublic =
				await AlkemiEarnPublicHarness.new().send({
					from: accounts[0],
				});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			const customer = accounts[1];
			
			const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
				from: accounts[0],
			});

			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, 100)
				.send({ gas: tokenTransferGas, from: accounts[0] });

			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(alkemiEarnPublic._address, 95)
				.send({ from: customer });

			await alkemiEarnPublic.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: accounts[0] });

			// Set zero as the previous supply index for the customer. This should cause div by zero error in balance calc.
			// To reach that we also have to set the previous principal to a non-zero value otherwise we will short circuit.
			await alkemiEarnPublic.methods
				.harnessSetAccountSupplyBalance(customer, OMG._address, 1, 0)
				.send({ from: accounts[0] });

			await truffleAssert.reverts(alkemiEarnPublic.methods
				.withdraw(OMG._address, 90)
				.send({ from: customer }));
		});

		it("reverts if token transfer fails", async () => {
			const alkemiEarnPublic =
				await AlkemiEarnPublicHarness.new().send({
					from: accounts[0],
				});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			const customer = accounts[1];
			
			const OMG = await EIP20.new(
				(10 ** 18).toString(10),
				"test omg ns",
				18,
				"omg"
			).send({ from: accounts[0] });
			// Support market
			await alkemiEarnPublic.methods
				.harnessSetAssetPriceMantissa(
					OMG._address,
					getExpMantissa(0.5).toString(10)
				)
				.send({ from: accounts[0] });
			await alkemiEarnPublic.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: accounts[0] });
			// Give protocol cash
			await OMG.methods
				.harnessSetBalance(alkemiEarnPublic._address, 100)
				.send({ from: accounts[0] });

			await alkemiEarnPublic.methods
				.harnessSetAccountSupplyBalance(customer, OMG._address, 100, 2)
				.send({ from: accounts[0] });


			// Configure market state for OMG: a supply of 1000 and supply and borrow indexes of 1.
			await alkemiEarnPublic.methods
				.harnessSetMarketDetails(OMG._address, 400, 100, 1, 1, 500, 100)
				.send({ from: accounts[0] });

			// Use harness to set up a transfer out error
			await OMG.methods
				.harnessSetFailTransferToAddress(customer, true)
				.send({ from: accounts[0] });

			await truffleAssert.reverts(
				alkemiEarnPublic.methods
					.withdraw(OMG._address, 1)
					.send({ from: customer })
			);
		});

		it("returns error if protocol total cash calculation fails", async () => {
			const alkemiEarnPublic =
				await AlkemiEarnPublicHarness.new().send({
					from: accounts[0],
				});
			await readAndExecContract(alkemiEarnPublic, "initializer", [], {
				from: accounts[0],
			});
			const customer = accounts[1];
		
			const OMG = await EIP20.new(
				bigNums.maxUint.toString(10),
				"test omg",
				18,
				"omg"
			).send({
				from: accounts[0],
			});

			// Transfer token (e.g. via ICO) to customer
			await OMG.methods
				.transfer(customer, bigNums.maxUint.toString(10))
				.send({ gas: tokenTransferGas, from: accounts[0] });

			// Customer now approves our Alkemi Earn Verified to spend its value
			await OMG.methods
				.approve(
					alkemiEarnPublic._address,
					bigNums.maxUint.toString(10)
				)
				.send({ from: customer });

			await alkemiEarnPublic.methods
				.harnessSetAssetPriceMantissa(
					OMG._address,
					getExpMantissa(0.5).toString(10)
				)
				.send({ from: accounts[0] });
			await alkemiEarnPublic.methods
				.harnessSupportMarket(OMG._address)
				.send({ from: accounts[0] });

			await alkemiEarnPublic.methods
				.harnessSetMarketDetails(OMG._address, 10, 0, 1, 0, 0, 1)
				.send({ from: accounts[0] });

			// We are going to supply 1, so fake out protocol current cash as maxUint so when we add the new cash it will overflow.
			await alkemiEarnPublic.methods
				.harnessSetCash(OMG._address, bigNums.maxUint.toString(10))
				.send({ from: accounts[0] });

			await truffleAssert.reverts(alkemiEarnPublic.methods
				.withdraw(OMG._address, 1)
				.send({ from: customer }));
		});
	
	})


describe("borrow", async () => {
	it("returns error and logs info if contract is paused", async () => {
		const alkemiEarnPublic =
			await AlkemiEarnPublicHarness.new().send({
				from: accounts[0],
			});
		await readAndExecContract(alkemiEarnPublic, "initializer", [], {
			from: accounts[0],
		});
		const customer = accounts[1];

		const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
			from: accounts[0],
		});

		await alkemiEarnPublic.methods
			._adminFunctions(accounts[0], accounts[0], true, 1000000000000000,0)
			.send({ from: accounts[0] });

		await truffleAssert.reverts(alkemiEarnPublic.methods
			.borrow(OMG._address, 90)
			.send({ from: customer }));
	});

	it("fails if market not supported", async () => {
		const alkemiEarnPublic =
			await AlkemiEarnPublicHarness.new().send({
				from: accounts[0],
			});
		await readAndExecContract(alkemiEarnPublic, "initializer", [], {
			from: accounts[0],
		});
		const customer = accounts[1];

		const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
			from: accounts[0],
		});

		await truffleAssert.reverts(alkemiEarnPublic.methods
			.borrow(OMG._address, 90)
			.send({ from: customer }));
	});

	it("returns error if new supply interest index calculation fails", async () => {
		const alkemiEarnPublic =
			await AlkemiEarnPublicHarness.new().send({
				from: accounts[0],
			});
		await readAndExecContract(alkemiEarnPublic, "initializer", [], {
			from: accounts[0],
		});
		const customer = accounts[1];

		const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
			from: accounts[0],
		});

		// Support market
		await alkemiEarnPublic.methods
			.harnessSupportMarket(OMG._address)
			.send({ from: accounts[0] });

		// Store a block number that should be HIGHER than the current block number so we'll get an underflow
		// when calculating block delta.
		await alkemiEarnPublic.methods
			.harnessSetMarketBlockNumber(OMG._address, -1)
			.send({ from: accounts[0] });

		await truffleAssert.reverts(alkemiEarnPublic.methods
			.borrow(OMG._address, 90)
			.send({ from: customer }));
	});

	it("returns error if accumulated balance calculation fails", async () => {
		const alkemiEarnPublic =
			await AlkemiEarnPublicHarness.new().send({
				from: accounts[0],
			});
		await readAndExecContract(alkemiEarnPublic, "initializer", [], {
			from: accounts[0],
		});
		const customer = accounts[1];
		
		const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
			from: accounts[0],
		});

		// Support market
		await alkemiEarnPublic.methods
			.harnessSupportMarket(OMG._address)
			.send({ from: accounts[0] });

		// Set zero as the previous supply index for the customer. This should cause div by zero error in balance calc.
		// To reach that we also have to set the previous principal to a non-zero value otherwise we will short circuit.
		await alkemiEarnPublic.methods
			.harnessSetAccountBorrowBalance(customer, OMG._address, 1, 0)
			.send({ from: accounts[0] });

		await truffleAssert.reverts(alkemiEarnPublic.methods
			.borrow(OMG._address, 90)
			.send({ from: customer }));
	});

	it("returns error if customer total new balance calculation fails", async () => {
		const alkemiEarnPublic =
			await AlkemiEarnPublicHarness.new().send({
				from: accounts[0],
			});
		await readAndExecContract(alkemiEarnPublic, "initializer", [], {
			from: accounts[0],
		});
		const customer = accounts[1];

		const OMG = await EIP20.new(
			bigNums.maxUint.toString(10),
			"test omg",
			18,
			"omg"
		).send({
			from: accounts[0],
		});

		// Support market
		await alkemiEarnPublic.methods
			.harnessSupportMarket(OMG._address)
			.send({ from: accounts[0] });

		// Set price of OMG to 1:1
		await alkemiEarnPublic.methods
			.harnessSetAssetPrice(OMG._address, 1, 1)
			.send({ from: accounts[0] });

		// Clear out collateral ratio so user can borrow
		await alkemiEarnPublic.methods
			.harnessSetCollateralRatio(0, 1)
			.send({ from: accounts[0] });

		// We are going to borrow 1, so give an existing balance of maxUint to cause an overflow.
		await alkemiEarnPublic.methods
			.harnessSetAccountBorrowBalance(
				customer,
				OMG._address,
				bigNums.maxUint.toString(10),
				1
			)
			.send({ from: accounts[0] });

		// Set market details
		await alkemiEarnPublic.methods
			.harnessSetMarketDetails(OMG._address, 0, 0, 1, 0, 0, 1)
			.send({ from: accounts[0] });

		await truffleAssert.reverts(alkemiEarnPublic.methods
			.borrow(OMG._address, 1)
			.send({ from: customer }));
	});

	it("returns error if protocol total borrow calculation fails via underflow", async () => {
		const alkemiEarnPublic =
			await AlkemiEarnPublicHarness.new().send({
				from: accounts[0],
			});
		await readAndExecContract(alkemiEarnPublic, "initializer", [], {
			from: accounts[0],
		});
		const customer = accounts[1];

		const OMG = await EIP20.new(
			bigNums.maxUint.toString(10),
			"test omg",
			18,
			"omg"
		).send({
			from: accounts[0],
		});

		// Support market
		await alkemiEarnPublic.methods
			.harnessSupportMarket(OMG._address)
			.send({ from: accounts[0] });

		// Set price of OMG to 1:1
		await alkemiEarnPublic.methods
			.harnessSetAssetPrice(OMG._address, 1, 1)
			.send({ from: accounts[0] });

		// Clear out collateral ratio so user can borrow
		await alkemiEarnPublic.methods
			.harnessSetCollateralRatio(0, 1)
			.send({ from: accounts[0] });

		// We are going to borrow 1, so give an existing balance of maxUint to cause an overflow.
		await alkemiEarnPublic.methods
			.harnessSetAccountBorrowBalance(
				customer,
				OMG._address,
				bigNums.maxUint.toString(10),
				1
			)
			.send({ from: accounts[0] });

		await truffleAssert.reverts(alkemiEarnPublic.methods
			.borrow(OMG._address, 1)
			.send({ from: customer }));
	});

	it("returns error if protocol total borrow calculation fails", async () => {
		const alkemiEarnPublic =
			await AlkemiEarnPublicHarness.new().send({
				from: accounts[0],
			});
		await readAndExecContract(alkemiEarnPublic, "initializer", [], {
			from: accounts[0],
		});
		const customer = accounts[1];

		const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
			from: accounts[0],
		});

		// Support market
		await alkemiEarnPublic.methods
			.harnessSupportMarket(OMG._address)
			.send({ from: accounts[0] });

		// Set price of OMG to 1:1
		await alkemiEarnPublic.methods
			.harnessSetAssetPrice(OMG._address, 1, 1)
			.send({ from: accounts[0] });

		// Clear out collateral ratio so user can borrow
		await alkemiEarnPublic.methods
			.harnessSetCollateralRatio(0, 1)
			.send({ from: accounts[0] });

		// Give the protocol a token balance of maxUint so when we calculate adding the new supply to it, it will overflow.
		await alkemiEarnPublic.methods
			.harnessSetMarketDetails(
				OMG._address,
				0,
				0,
				1,
				bigNums.maxUint.toString(10),
				0,
				1
			)
			.send({ from: accounts[0] });

		await truffleAssert.reverts(alkemiEarnPublic.methods
			.borrow(OMG._address, 1)
			.send({ from: customer }));
	});

	it("returns error if protocol total cash calculation fails", async () => {
		const alkemiEarnPublic =
			await AlkemiEarnPublicHarness.new().send({
				from: accounts[0],
			});
		await readAndExecContract(alkemiEarnPublic, "initializer", [], {
			from: accounts[0],
		});
		const customer = accounts[1];

		const OMG = await EIP20.new(
			bigNums.maxUint.toString(10),
			"test omg",
			18,
			"omg"
		).send({
			from: accounts[0],
		});

		// Support market
		await alkemiEarnPublic.methods
			.harnessSupportMarket(OMG._address)
			.send({ from: accounts[0] });

		// Set price of OMG to 1:1
		await alkemiEarnPublic.methods
			.harnessSetAssetPrice(OMG._address, 1, 1)
			.send({ from: accounts[0] });

		// Clear out collateral ratio so user can borrow
		await alkemiEarnPublic.methods
			.harnessSetCollateralRatio(0, 1)
			.send({ from: accounts[0] });

		// Give the protocol a token balance of maxUint so when we calculate adding the new supply to it, it will overflow.
		await alkemiEarnPublic.methods
			.harnessSetMarketDetails(OMG._address, 0, 0, 1, 0, 0, 1)
			.send({ from: accounts[0] });

		// We are going to borrow 1, so fake out protocol current cash as 0 so when we sub the new cash it will underflow.
		await alkemiEarnPublic.methods
			.harnessSetCash(OMG._address, 0)
			.send({ from: accounts[0] });

		await truffleAssert.reverts(alkemiEarnPublic.methods
			.borrow(OMG._address, 1)
			.send({ from: customer }));
	});
});
describe("repayBorrow", async () => {
	it("returns error and logs info if contract is paused", async () => {
		const alkemiEarnPublic =
			await AlkemiEarnPublicHarness.new().send({
				from: accounts[0],
			});
		await readAndExecContract(alkemiEarnPublic, "initializer", [], {
			from: accounts[0],
		});
		const customer = accounts[1];
		
		const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
			from: accounts[0],
		});

		// Transfer token (e.g. via ICO) to customer
		await OMG.methods
			.transfer(customer, 100)
			.send({ gas: tokenTransferGas, from: accounts[0] });

		// Customer now approves our Alkemi Earn Verified to spend its value
		await OMG.methods
			.approve(alkemiEarnPublic._address, 95)
			.send({ from: customer });

		await alkemiEarnPublic.methods
			._adminFunctions(accounts[0], accounts[0], true, 1000000000000000,0)
			.send({ from: accounts[0] });

		await truffleAssert.reverts(alkemiEarnPublic.methods
			.repayBorrow(OMG._address, 90)
			.send({ from: customer }));
	});

	it("returns error if new borrow interest index calculation fails", async () => {
		const alkemiEarnPublic =
			await AlkemiEarnPublicHarness.new().send({
				from: accounts[0],
			});
		await readAndExecContract(alkemiEarnPublic, "initializer", [], {
			from: accounts[0],
		});
		const customer = accounts[1];

		const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
			from: accounts[0],
		});

		// Transfer token (e.g. via ICO) to customer
		await OMG.methods
			.transfer(customer, 100)
			.send({ gas: tokenTransferGas, from: accounts[0] });

		// Customer now approves our Alkemi Earn Verified to spend its value
		await OMG.methods
			.approve(alkemiEarnPublic._address, 95)
			.send({ from: customer });

		// Store a block number that should be HIGHER than the current block number so we'll get an underflow
		// when calculating block delta.
		await alkemiEarnPublic.methods
			.harnessSetMarketBlockNumber(OMG._address, -1)
			.send({ from: accounts[0] });

		await truffleAssert.reverts(alkemiEarnPublic.methods
			.repayBorrow(OMG._address, 90)
			.send({ from: customer }));
	});

	it("returns error if accumulated balance calculation fails", async () => {
		const alkemiEarnPublic =
			await AlkemiEarnPublicHarness.new().send({
				from: accounts[0],
			});
		await readAndExecContract(alkemiEarnPublic, "initializer", [], {
			from: accounts[0],
		});
		const customer = accounts[1];

		const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
			from: accounts[0],
		});

		// Transfer token (e.g. via ICO) to customer
		await OMG.methods
			.transfer(customer, 100)
			.send({ gas: tokenTransferGas, from: accounts[0] });

		// Customer now approves our Alkemi Earn Verified to spend its value
		await OMG.methods
			.approve(alkemiEarnPublic._address, 95)
			.send({ from: customer });

		// Set zero as the previous borrow index for the customer. This should cause div by zero error in balance calc.
		// To reach that we also have to set the previous principal to a non-zero value otherwise we will short circuit.
		await alkemiEarnPublic.methods
			.harnessSetAccountBorrowBalance(customer, OMG._address, 1, 0)
			.send({ from: accounts[0] });

		await alkemiEarnPublic.methods
			.repayBorrow(OMG._address, 90)
			.send({ from: customer });
	});

	it("returns error if customer total new balance calculation fails", async () => {
		const alkemiEarnPublic =
			await AlkemiEarnPublicHarness.new().send({
				from: accounts[0],
			});
		await readAndExecContract(alkemiEarnPublic, "initializer", [], {
			from: accounts[0],
		});
		const customer = accounts[1];
		
		const OMG = await EIP20.new(
			bigNums.maxUint.toString(10),
			"test omg",
			18,
			"omg"
		).send({
			from: accounts[0],
		});

		// Transfer token (e.g. via ICO) to customer
		await OMG.methods
			.transfer(customer, bigNums.maxUint.toString(10))
			.send({ gas: tokenTransferGas, from: accounts[0] });

		// Customer now approves our Alkemi Earn Verified to spend its value
		await OMG.methods
			.approve(
				alkemiEarnPublic._address,
				bigNums.maxUint.toString(10)
			)
			.send({ from: customer });

		// We are going to repay 1 borrow, so give an existing balance of maxUint to cause an overflow.
		await alkemiEarnPublic.methods
			.harnessSetAccountBorrowBalance(customer, OMG._address, 0, 1)
			.send({ from: accounts[0] });

		await alkemiEarnPublic.methods
			.repayBorrow(OMG._address, 1)
			.send({ from: customer });
	});

	it("returns error if protocol total borrow calculation fails via overflow", async () => {
		const alkemiEarnPublic =
			await AlkemiEarnPublicHarness.new().send({
				from: accounts[0],
			});
		await readAndExecContract(alkemiEarnPublic, "initializer", [], {
			from: accounts[0],
		});
		const customer = accounts[1];
		
		const OMG = await EIP20.new(100, "test omg", 18, "omg").send({
			from: accounts[0],
		});

		// Transfer token (e.g. via ICO) to customer
		await OMG.methods
			.transfer(customer, 100)
			.send({ gas: tokenTransferGas, from: accounts[0] });

		// Customer now approves our Alkemi Earn Verified to spend its value
		await OMG.methods
			.approve(alkemiEarnPublic._address, 95)
			.send({ from: customer });

		// Give user some balance
		await alkemiEarnPublic.methods
			.harnessSetAccountBorrowBalance(customer, OMG._address, 10, 1)
			.send({ from: accounts[0] });

		// Give the protocol a token balance of 0 so when we calculate subtract the new borrow from it, it will underflow.
		await alkemiEarnPublic.methods
			.harnessSetMarketDetails(OMG._address, 0, 0, 1, 0, 0, 1)
			.send({ from: accounts[0] });

		await alkemiEarnPublic.methods
			.repayBorrow(OMG._address, 1)
			.send({ from: customer });
	});

	it("returns error if protocol total cash calculation fails", async () => {
		const alkemiEarnPublic =
			await AlkemiEarnPublicHarness.new().send({
				from: accounts[0],
			});
		await readAndExecContract(alkemiEarnPublic, "initializer", [], {
			from: accounts[0],
		});
		const customer = accounts[1];
		
		const OMG = await EIP20.new(
			bigNums.maxUint.toString(10),
			"test omg",
			18,
			"omg"
		).send({
			from: accounts[0],
		});

		// Transfer token (e.g. via ICO) to customer
		await OMG.methods
			.transfer(customer, bigNums.maxUint.toString(10))
			.send({ gas: tokenTransferGas, from: accounts[0] });

		// Customer now approves our Alkemi Earn Verified to spend its value
		await OMG.methods
			.approve(
				alkemiEarnPublic._address,
				bigNums.maxUint.toString(10)
			)
			.send({ from: customer });

		// Give user some balance
		await alkemiEarnPublic.methods
			.harnessSetAccountBorrowBalance(customer, OMG._address, 10, 1)
			.send({ from: accounts[0] });

		// Have sufficient borrows outstanding
		await alkemiEarnPublic.methods
			.harnessSetMarketDetails(OMG._address, 0, 0, 1, 10, 0, 1)
			.send({ from: accounts[0] });

		// We are going to pay borrow of 1, so fake out protocol current cash as maxUint so when we add the new cash it will overflow.
		await alkemiEarnPublic.methods
			.harnessSetCash(OMG._address, bigNums.maxUint.toString(10))
			.send({ from: accounts[0] });

		await truffleAssert.reverts(alkemiEarnPublic.methods
			.repayBorrow(OMG._address, 1)
			.send({ from: customer }));
	});
});

describe("liquidateBorrow", async () => {
	it("returns error and logs info if contract is paused", async () => {
		const {
			alkemiEarnPublic,
			borrower,
			liquidator,
			borrowed,
			collateral,
			supplyCollateralBlock,
			borrowBlock,
		} = await setupValidLiquidation();

		await alkemiEarnPublic.methods
			._adminFunctions(accounts[0], accounts[0], true, 1000000000000000,0)
			.send({ from: accounts[0] });

		await truffleAssert.reverts(alkemiEarnPublic.methods
			.liquidateBorrow(borrower, borrowed._address, collateral._address, 6)
			.send({ from: liquidator }));
	});



	it("allows max for liquidation of 0", async () => {
		const {
			alkemiEarnPublic,
			borrower,
			liquidator,
			borrowed,
			collateral,
			supplyCollateralBlock,
			borrowBlock,
		} = await setupValidLiquidation();

		// Make borrower's collateral more valuable so the borrow is not eligible for liquidation.
		// Set price of collateral to 4:1
		await alkemiEarnPublic.methods
			.harnessSetAssetPrice(collateral._address, 4, 1)
			.send({ from: accounts[0] });

		/////////// Call function. liquidate max by specifying -1
		const liquidateResult = await alkemiEarnPublic.methods
			.liquidateBorrow(borrower, borrowed._address, collateral._address, -1)
			.send({ from: liquidator });

	
		// Liquidator's off-protocol token balance should have declined by the amount used to reduce the target user's borrow
		const liquidatorTokenBalance = await borrowed.methods
			.balanceOf(liquidator)
			.call();
	});

	it("handles unset price oracle", async () => {
		// We start with a valid setup then tweak as necessary to hit the desired error condition.
		const {
			alkemiEarnPublic,
			borrower,
			liquidator,
			borrowed,
			collateral,
		} = await setupValidLiquidation();

		// SETUP DESIRED FAILURE:
		// Set current borrow interest index to maxUint so when we multiply by it we get an overflow
		await alkemiEarnPublic.methods
			.harnessSetOracle("0x0000000000000000000000000000000000000000")
			.send({ from: accounts[0] });
		await alkemiEarnPublic.methods
			.harnessSetUseOracle(true)
			.send({ from: accounts[0] });

		/////////// Call function
		const liquidateResult = await truffleAssert.reverts(alkemiEarnPublic.methods
			.liquidateBorrow(borrower, borrowed._address, collateral._address, 1)
			.send({ from: liquidator }));

		await validateFailedLiquidation(
			liquidateResult,
			alkemiEarnPublic,
			borrower,
			borrowed,
			collateral,
			liquidator
		);
	});

	it("fails with zero oracle price (borrowed)", async () => {
		// We start with a valid setup then tweak as necessary to hit the desired error condition.
		const {
			alkemiEarnPublic,
			borrower,
			liquidator,
			borrowed,
			collateral,
		} = await setupValidLiquidation();

		// Set oracle price to zero for borrowed
		await alkemiEarnPublic.methods
			.harnessSetAssetPriceMantissa(borrowed._address, 0)
			.send({ from: accounts[0] });

		/////////// Call function
		const liquidateResult = await alkemiEarnPublic.methods
			.liquidateBorrow(borrower, borrowed._address, collateral._address, 1)
			.send({ from: liquidator });

		await validateFailedLiquidation(
			liquidateResult,
			alkemiEarnPublic,
			borrower,
			borrowed,
			collateral,
			liquidator
		);
	});

	it("fails with zero oracle price (collateral)", async () => {
		// We start with a valid setup then tweak as necessary to hit the desired error condition.
		const {
			alkemiEarnPublic,
			borrower,
			liquidator,
			borrowed,
			collateral,
		} = await setupValidLiquidation();

		// Set oracle price to zero for borrowed
		await alkemiEarnPublic.methods
			.harnessSetAssetPriceMantissa(collateral._address, 0)
			.send({ from: accounts[0] });

		/////////// Call function
		const liquidateResult = await alkemiEarnPublic.methods
			.liquidateBorrow(borrower, borrowed._address, collateral._address, 1)
			.send({ from: liquidator });

		await validateFailedLiquidation(
			liquidateResult,
			alkemiEarnPublic,
			borrower,
			borrowed,
			collateral,
			liquidator
		);
	});

	it("handles failure to calculate discounted borrow-denominated shortfall", async () => {
		// We start with a valid setup then tweak as necessary to hit the desired error condition.
		const {
			alkemiEarnPublic,
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
		await alkemiEarnPublic.methods
			.harnessSetAssetPrice(borrowed._address, 1, (10 ** 18).toString(10))
			.send({ from: accounts[0] });
		await alkemiEarnPublic.methods
			.harnessSetAssetPrice(collateral._address, 1, (10 ** 18).toString(10))
			.send({ from: accounts[0] });
		await alkemiEarnPublic.methods
			.harnessSetLiquidationDiscount("999000000000000000")
			.send({ from: accounts[0] }); // .999

		/////////// Call function
		const result = await alkemiEarnPublic.methods
			.liquidateBorrow(borrower, borrowed._address, collateral._address, 1)
			.send({ from: liquidator });

		await validateFailedLiquidation(
			result,
			alkemiEarnPublic,
			borrower,
			borrowed,
			collateral,
			liquidator
		);
	});

	it("handles failure to calculate discounted borrow-denominated collateral", async () => {
		// We start with a valid setup then tweak as necessary to hit the desired error condition.
		const {
			alkemiEarnPublic,
			borrower,
			liquidator,
			borrowed,
			collateral,
		} = await setupValidLiquidation();

		// SETUP DESIRED FAILURE:
		// use harness method to flag method for failure
		await alkemiEarnPublic.methods
			.harnessSetFailBorrowDenominatedCollateralCalculation(true)
			.send({ from: accounts[0] });

		/////////// Call function
		const result = alkemiEarnPublic.methods
			.liquidateBorrow(borrower, borrowed._address, collateral._address, 1)
			.send({ from: liquidator });

		await validateFailedLiquidation(
			result,
			alkemiEarnPublic,
			borrower,
			borrowed,
			collateral,
			liquidator
		);
	});

	it("handles case of liquidator requesting to close too much of borrow", async () => {
		// We start with a valid setup then tweak as necessary to hit the desired error condition.
		const {
			alkemiEarnPublic,
			borrower,
			liquidator,
			borrowed,
			collateral,
		} = await setupValidLiquidation();

		/////////// Call function with a requested amount that is too high
		const result = await alkemiEarnPublic.methods
			.liquidateBorrow(borrower, borrowed._address, collateral._address, 30)
			.send({ from: liquidator });

		await validateFailedLiquidation(
			result,
			alkemiEarnPublic,
			borrower,
			borrowed,
			collateral,
			liquidator
		);
	});

	it("handles failure to calculate new total cash for the borrowed asset", async () => {
		// We start with a valid setup then tweak as necessary to hit the desired error condition.
		const {
			alkemiEarnPublic,
			borrower,
			liquidator,
			borrowed,
			collateral,
		} = await setupValidLiquidation();

		// SETUP DESIRED FAILURE:
		// We are going to repay 1, so fake out protocol current cash as maxUint so when we add the new cash it will overflow.
		await alkemiEarnPublic.methods
			.harnessSetCash(borrowed._address, bigNums.maxUint.toString(10))
			.send({ from: accounts[0] });

		/////////// Call function
		const result = await alkemiEarnPublic.methods
			.liquidateBorrow(borrower, borrowed._address, collateral._address, 1)
			.send({ from: liquidator });

		await validateFailedLiquidation(
			result,
			alkemiEarnPublic,
			borrower,
			borrowed,
			collateral,
			liquidator
		);
	});

	it("handles liquidator failure to approve borrowed asset for transfer in to protocol", async () => {
		// We start with a valid setup then tweak as necessary to hit the desired error condition.
		const {
			alkemiEarnPublic,
			borrower,
			liquidator,
			borrowed,
			collateral,
		} = await setupValidLiquidation();

		// SETUP DESIRED FAILURE:
		// remove liquidator's approval for borrowed asset
		await borrowed.methods
			.approve(alkemiEarnPublic._address, 0)
			.send({ from: liquidator });

		/////////// Call function
		const result = await alkemiEarnPublic.methods
			.liquidateBorrow(borrower, borrowed._address, collateral._address, 1)
			.send({ from: liquidator });

		await validateFailedLiquidation(
			result,
			alkemiEarnPublic,
			borrower,
			borrowed,
			collateral,
			liquidator
		);
	});
});


});









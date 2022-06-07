"use strict";

const web3_ = require("./Web3");

const BigNumber = require("bignumber.js");

// For more details, see Appendix G of https://yellowpaper.io
const gas = {
	storage_read: 200, // G_sload
	storage_new: 20000, // G_sset
	storage_update: 5000, // G_sreset
	transaction: 21000, // G_transaction
};

// Simple fake addresses for assets. We may swap with our own deployed ERC-20 contracts.
const assets = {
	OMG: "0x74Be241879043F34368AA807Ea69d38A04D3f84a",
	ETH: "0xb5aa7979f26249e042c045364bb2b86cd3b3c2e2",
};

const checksum = web3_.utils.toChecksumAddress;

// Convenience constants for commonly-used or difficult to remember bignum values
const bigNums = {
	// 2^256 - 1  http://www.wolframalpha.com/input/?i=2%5E256+-+1
	maxUint: new BigNumber(
		"115792089237316195423570985008687907853269984665640564039457584007913129639935"
	),

	// TODO: This is larger than maxExp. MaxExp is (2^256 -1) / 10^18 = 1.1579208923731619542357098500868790785326998466564056... × 10^59
	// log2 of that is 196.2052942920274777383342502691909768344330349255575489830...
	// 2^(256-19) - 1 = 2^237 - 1
	maxExp: new BigNumber(
		"220855883097298041197912187592864814478435487109452369765200775161577471"
	),

	realMaxExp: new BigNumber(
		"115792089237316195423570985008687907853269984665640564039457584007913129639935"
	).dividedToIntegerBy(new BigNumber("1000000000000000000")),

	// 1e18
	ether: new BigNumber("1000000000000000000"),
	collateral: new BigNumber("1250000000000000"),
};

// Generated a range of 1..n
function range(n) {
	return [...Array(n).keys()];
}

// Helper function to test for the presence of a log in a transaction result
// The event must match directly (we'll only look for the first matching event)
// For each param specified, we check to see that the key/value matches in the log data.
assert.hasLog = function (result, event, params) {
	const logParams = {};

	const log = result.events[event];

	if (!log) {
		const events = Object.keys(result.events).join(", ");
		assert.fail(
			0,
			1,
			`Expected log with event \`${event}\`, found logs with events: [${events}]`
		);
	}

	Object.keys(params).forEach((key) => {
		logParams[key] = log.returnValues[key];
	});

	assert.deepEqual(
		logParams,
		params,
		`Expected matching log params for event \`${event}\``
	);
};



assert.withinPercentage = function (expected, result, percentage, message) {
	assert.isNotNaN(
		expected,
		`${message}: Expected "expected" in withinPercentage ${expected} to not be NaN`
	);
	assert.isNotNaN(
		result,
		`${message}: Expected "result" in withinPercentage ${result} to not be NaN`
	);

	const percentDifference = Math.abs((expected - result) / expected) * 100;

	if (percentDifference > percentage) {
		assert.fail(
			0,
			1,
			`${message}: Expected ${result} to be within ${percentage}% of ${expected}, but was ${percentDifference}%`
		);
	}
};

assert.matchesAddress = function (actual, expected) {
	assert.equal(
		checksum(actual),
		checksum(expected),
		`expected ${expected} to match address ${actual}`
	);
};

// Checks to see that the gas used in a transaction is within a delta of an expected amount.
// The amount should not include the base 21K gas for the transaction itself.
assert.withinGas = function (
	result,
	expected,
	delta,
	message,
	excludeTrxFee = false
) {
	assert.approximately(
		result.gasUsed,
		expected + (excludeTrxFee ? 0 : gas.transaction),
		delta,
		message
	);
};

assert.hasFailure = function (
	expectedError,
	expectedFailureInfo,
	expectedDetail = undefined
) {

	const expected = {
		Error: expectedError,
		FailureInfo: expectedFailureInfo,
	};

	const actual = {
		Error: log.returnValues[0],
		FailureInfo: log.returnValues[1],
	};

	if (expectedDetail !== undefined) {
		expected.Detail = expectedDetail;
		actual.Detail = Number(log.returnValues[2]);
	}

	assert.deepEqual(actual, expected);
};


assert.bigNumEquals = function (expectedBigNum, actual) {
	if (!BigNumber.isBigNumber(expectedBigNum)) {
		assert.fail(
			0,
			1,
			`Expected expectedBigNum to be a BigNum: [${expectedBigNum}]`
		);
	}

	if (!expectedBigNum.isEqualTo(actual)) {
		// expectedBigNum.toString(10) ensures normal vs scientific output per bignumber.js docs
		assert.fail(
			0,
			1,
			`Expected actual (${actual}) to equal ${expectedBigNum.toString(10)}`
		);
	}
};

// Returns the mantissa of an Exp with given floating value
function getExpMantissa(float) {
	return Math.floor(float * 1.0e18);
}
const PREFIX = "Transaction has been reverted by the EVM: ";

module.exports = {
	assets,
	bigNums,
	checksum,
	gas,
	getExpMantissa,
	range,
	assert,
};
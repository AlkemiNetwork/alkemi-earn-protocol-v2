/**
 * remove comments for public chain migration
 */
const HDWalletProvider = require("truffle-hdwallet-provider");
const fs = require("fs");
//const mnemonic = fs.readFileSync(".mnemonic").toString().trim();
const infuraKey = "";

let mochaOptions = {
  enableTimeouts: false,
  before_timeout: 0,
  test_timeout: 0,
};

if (process.env.SOLIDITY_COVERAGE) {
  mochaOptions = {
    enableTimeouts: false,
    grep: /@gas/,
    invert: true,
    before_timeout: 0,
    test_timeout: 0,
  };
}

module.exports = {
  networks: {
    rinkeby: {
      provider: () =>
        new HDWalletProvider(
          mnemonic,
          `https://rinkeby.infura.io/v3/${infuraKey}`
        ),
      network_id: 4,
      skipDryRun: true, // Skip dry run before migrations? (default: false for public nets )
    },
    development: {
      host: "127.0.0.1", // Localhost (default: none)
      port: 9545, // Standard Ethereum port (default: none)
      network_id: "*", // Any network (default: none)
    },

    test: {
      host: "127.0.0.1", // Localhost (default: none)
      port: 9545,
      network_id: "*",
    },
    ganacheUI: {
      host: "127.0.0.1", // Localhost (default: none)
      port: 7545, // Standard Ethereum port (default: none)
      network_id: "*", // Any network (default: none)
    },
    coverage: {
      host: "127.0.0.1", // Localhost (default: none)
      network_id: "*",
      port: 8555, // <-- If you change this, also set the port option in .solcover.js.
      gas: 0xfffffffffff, // <-- Use this high gas value
      gasPrice: 0x01, // <-- Use this low gas price
    },

    kovan: {
      provider: () =>
        new HDWalletProvider(
          mnemonic,
          `https://kovan.infura.io/v3/${infuraKey}`
        ),
      gasPrice: 1000000000,
      network_id: 42,
      skipDryRun: true, // Skip dry run before migrations? (default: false for public nets )
    },
    ropsten: {
      provider: () =>
        new HDWalletProvider(
          mnemonic,
          `https://ropsten.infura.io/v3/${infuraKey}`
        ),
      network_id: 3,
      skipDryRun: true, // Skip dry run before migrations? (default: false for public nets )
    },
    mainnet: {
      provider: () =>
        new HDWalletProvider(
          mnemonic,
          `https://mainnet.infura.io/v3/${infuraKey}`
        ),
      gasPrice: 25000000000,
      timeoutBlocks: 4000,
      network_id: 1,
      skipDryRun: false, // Skip dry run before migrations? (default: false for public nets )
    },
  },

  // Set default mocha options here, use special reporters etc.
  mocha: mochaOptions,

  compilers: {
    solc: {
      version: "0.8.11", // Fetch exact version from solc-bin (default: truffle's version)
      settings: {
        // See the solidity docs for advice about optimization and evmVersion
        optimizer: {
          enabled: true,
          runs: 800,
        },
      },
    },
  },
  plugins: ["truffle-contract-size"],
};

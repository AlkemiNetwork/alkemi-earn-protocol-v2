var AlkemiEarnPublic = artifacts.require("AlkemiEarnPublic.sol");
var AlkemiEarnVerified = artifacts.require("AlkemiEarnVerified.sol");
var ChainLink = artifacts.require("ChainLink.sol");
var AlkemiWETH = artifacts.require("AlkemiWETH.sol");
var AlkemiRateModel = artifacts.require("AlkemiRateModel.sol");
var RewardControl = artifacts.require("RewardControl.sol");
var TestToken = artifacts.require("TestToken.sol");
// var testChainlink = artifacts.require("testChainlink.sol");

const deploymentConfig = require("./deployment-config.json");

module.exports = async (deployer, network, accounts) => {
  if (network == "rinkeby") {
    //deploy AlkemiWETH
    await deployer.deploy(AlkemiWETH);
    const alkWETH = await AlkemiWETH.deployed();

    //deploy chainlink
    await deployer.deploy(ChainLink);
    const priceOracle = await ChainLink.deployed();
    //add USDC for priceFeed
    await priceOracle.addAsset(
      deploymentConfig.RINKEBY.USDC,
      deploymentConfig.RINKEBY.USDC_PRICE_FEED
    );
    //add DAI for priceFeed
    await priceOracle.addAsset(
      deploymentConfig.RINKEBY.DAI,
      deploymentConfig.RINKEBY.DAI_PRICE_FEED
    );
    //add WBTC for priceFeed
    await priceOracle.addAsset(
      deploymentConfig.RINKEBY.WBTC,
      deploymentConfig.RINKEBY.WBTC_PRICE_FEED
    );
    //add WETH for priceFeed
    await priceOracle.addAsset(
      alkWETH.address,
      deploymentConfig.RINKEBY.WETH_PRICE_FEED
    );

    //deploy BTC Rate Model
    await deployer.deploy(
      AlkemiRateModel,
      "BTC Rate Model",
      100,
      200,
      250,
      8000,
      3000,
      5000
    );
    const BTCRateModel = await AlkemiRateModel.deployed();

    //deploy ETH Rate Model
    await deployer.deploy(
      AlkemiRateModel,
      "ETH Rate Model",
      100,
      400,
      250,
      8000,
      1100,
      3000
    );
    const ETHRateModel = await AlkemiRateModel.deployed();

    //deploy Stable Coin Rate Model
    await deployer.deploy(
      AlkemiRateModel,
      "Stable Coin Rate Model",
      100,
      2000,
      100,
      8000,
      400,
      3000
    );
    const StableCoinRateModel = await AlkemiRateModel.deployed();
    // 10000000000000000000000000
    //deploy Alkemi Earn Public
    await deployer.deploy(AlkemiEarnPublic);
    const alkemiEarnPublic = await AlkemiEarnPublic.deployed();
    await alkemiEarnPublic.initializer();
    await alkemiEarnPublic._adminFunctions(
      deploymentConfig.RINKEBY.ZERO_ADDRESS,
      priceOracle.address,
      false,
      1000000000000000,
      5000000000000000
    );
    // alkemiEarnPublic._supportMarket(
    // 	testToken1.address,
    // 	BTCRateModel.address
    // );

    alkemiEarnPublic._supportMarket(alkWETH.address, ETHRateModel.address);
    //support USDC market
    alkemiEarnPublic._supportMarket(
      deploymentConfig.RINKEBY.USDC,
      StableCoinRateModel.address
    );
    //support DAI market
    alkemiEarnPublic._supportMarket(
      deploymentConfig.RINKEBY.DAI,
      StableCoinRateModel.address
    );
    //support WBTC market
    alkemiEarnPublic._supportMarket(
      deploymentConfig.RINKEBY.WBTC,
      BTCRateModel.address
    );
    //support WETH market
    // alkemiEarnPublic._supportMarket(
    // 	alkWETH.address,
    //  	deploymentConfig.RINKEBY.WETH_RATE_MODEL
    // );

    //deploy Alkemi Earn Verifeid
    await deployer.deploy(AlkemiEarnVerified);
    const alkemiEarnVerified = await AlkemiEarnVerified.deployed();
    await alkemiEarnVerified.initializer();
    alkemiEarnVerified._supportMarket(alkWETH.address, ETHRateModel.address);
    //support USDC market
    alkemiEarnVerified._supportMarket(
      deploymentConfig.RINKEBY.USDC,
      StableCoinRateModel.address
    );
    //support DAI market
    alkemiEarnVerified._supportMarket(
      deploymentConfig.RINKEBY.DAI,
      StableCoinRateModel.address
    );
    //support WBTC market
    alkemiEarnVerified._supportMarket(
      deploymentConfig.RINKEBY.WBTC,
      BTCRateModel.address
    );

    //deploy Reward Control
    await deployer.deploy(RewardControl);
    const rewardControl = await RewardControl.deployed();

    await rewardControl.initializer(
      accounts[0],
      alkemiEarnVerified.address,
      alkemiEarnPublic.address,
      deploymentConfig.RINKEBY.ALK_TOKEN
    );
    await rewardControl.addMarket(alkWETH.address, true);
    await rewardControl.addMarket(alkWETH.address, false);
    await rewardControl.addMarket(deploymentConfig.RINKEBY.USDC, true);
    await rewardControl.addMarket(deploymentConfig.RINKEBY.USDC, false);
    await rewardControl.addMarket(deploymentConfig.RINKEBY.WBTC, true);
    await rewardControl.addMarket(deploymentConfig.RINKEBY.WBTC, false);
    await rewardControl.addMarket(deploymentConfig.RINKEBY.DAI, false);
    await rewardControl.addMarket(deploymentConfig.RINKEBY.DAI, true);

    await alkemiEarnVerified._adminFunctions(
      deploymentConfig.RINKEBY.ZERO_ADDRESS,
      priceOracle.address,
      false,
      1000000000000000,
      5000000000000000,
      alkWETH.address,
      rewardControl.address
    );
    await alkemiEarnPublic.setRewardControlAddress(rewardControl.address);
    await alkemiEarnVerified.setRewardControlAddress(rewardControl.address);
  }
  if (network == "development") {
    //deploy AlkemiWETH
    await deployer.deploy(AlkemiWETH);
    const alkWETH = await AlkemiWETH.deployed();

    //deploy chainlink
    await deployer.deploy(ChainLink);
    const priceOracle = await ChainLink.deployed();
    //add USDC for priceFeed
    // await priceOracle.addAsset(
    // 	testToken1.address,
    // 	priceOracle.address
    // );
    //add DAI for priceFeed
    /*await priceOracle.addAsset(
		   deploymentConfig.RINKEBY.DAI,
		   deploymentConfig.RINKEBY.DAI_PRICE_FEED
	   );
	   //add WBTC for priceFeed
	   await priceOracle.addAsset(
		   deploymentConfig.RINKEBY.WBTC,
		   deploymentConfig.RINKEBY.WBTC_PRICE_FEED
	   );
	   //add WETH for priceFeed
	   await priceOracle.addAsset(
		   alkWETH.address,
		   deploymentConfig.RINKEBY.WETH_PRICE_FEED
	   );
*/
    //deploy BTC Rate Model
    /*await deployer.deploy(
		   AlkemiRateModel,
		   "BTC Rate Model",
		   100,
		   200,
		   250,
		   8000,
		   3000,
		   5000
	   );
	   const BTCRateModel = await AlkemiRateModel.deployed();

	   //deploy ETH Rate Model
	   await deployer.deploy(
		   AlkemiRateModel,
		   "ETH Rate Model",
		   100,
		   400,
		   250,
		   8000,
		   1100,
		   3000
	   );
	   const ETHRateModel = await AlkemiRateModel.deployed();

	   //deploy Stable Coin Rate Model
	   await deployer.deploy(
		   AlkemiRateModel,
		   "Stable Coin Rate Model",
		   100,
		   2000,
		   100,
		   8000,
		   400,
		   3000
	   );
	   const StableCoinRateModel = await AlkemiRateModel.deployed();
	   */
    //deploy Alkemi Earn Public
    await deployer.deploy(AlkemiEarnPublic);
    const alkemiEarnPublic = await AlkemiEarnPublic.deployed();
    await alkemiEarnPublic.initializer();
    await alkemiEarnPublic._adminFunctions(
      deploymentConfig.RINKEBY.ZERO_ADDRESS,
      priceOracle.address,
      false,
      1000000000000000,
      5000000000000000
    );
    // alkemiEarnPublic._supportMarket(
    // 	testToken1.address,
    // 	BTCRateModel.address
    // );

    // alkemiEarnPublic._supportMarket(
    // 	alkWETH.address,
    //  	BTCRateModel.address
    // );
    //support USDC market
    /*	alkemiEarnPublic._supportMarket(
		   deploymentConfig.RINKEBY.USDC,
			deploymentConfig.RINKEBY.USDC_RATE_MODEL
	   );
	   //support DAI market
	   alkemiEarnPublic._supportMarket(
		   deploymentConfig.RINKEBY.DAI,
		   deploymentConfig.RINKEBY.DAI_RATE_MODEL
	   );
	   //support WBTC market
	   alkemiEarnPublic._supportMarket(
		   deploymentConfig.RINKEBY.WBTC,
			deploymentConfig.RINKEBY.WBTC_RATE_MODEL
	   );
	   //support WETH market
	   alkemiEarnPublic._supportMarket(
		   alkWETH.address,
			deploymentConfig.RINKEBY.WETH_RATE_MODEL
	   );
*/
    //deploy Alkemi Earn Verifeid
    await deployer.deploy(AlkemiEarnVerified);
    const alkemiEarnVerified = await AlkemiEarnVerified.deployed();
    await alkemiEarnVerified.initializer();

    //deploy Reward Control
    await deployer.deploy(RewardControl);
    const rewardControl = await RewardControl.deployed();

    await rewardControl.initializer(
      accounts[0],
      alkemiEarnVerified.address,
      alkemiEarnPublic.address,
      deploymentConfig.RINKEBY.ALK_TOKEN
    );
    // await rewardControl.addMarket(
    // 	testToken1.address,
    // 	true
    // );
    // await rewardControl.addMarket(
    // 	testToken1.address,
    // 	false
    // );
    // await rewardControl.addMarket(
    // 	alkWETH.address,
    // 	true
    // );
    // await rewardControl.addMarket(
    // 	alkWETH.address,
    // 	false
    // );
    /*await rewardControl.addMarket(
		   deploymentConfig.RINKEBY.USDC,
		   true
	   );
	   await rewardControl.addMarket(
		   deploymentConfig.RINKEBY.USDC,
		   false
	   );
	   await rewardControl.addMarket(
		   deploymentConfig.RINKEBY.WBTC,
		   true
	   );
	   await rewardControl.addMarket(
		   deploymentConfig.RINKEBY.WBTC,
		   false
	   );
	   await rewardControl.addMarket(
		   alkWETH.address,
		   true
	   );
	   await rewardControl.addMarket(
		   alkWETH.address,
		   false
	   );
	   await rewardControl.addMarket(
		   deploymentConfig.RINKEBY.DAI,
		   true
	   );
	   */
    await alkemiEarnVerified._adminFunctions(
      deploymentConfig.RINKEBY.ZERO_ADDRESS,
      priceOracle.address,
      false,
      1000000000000000,
      5000000000000000,
      alkWETH.address,
      rewardControl.address
    );
    // alkemiEarnVerified._supportMarket(
    // 	testToken1.address,
    // 	BTCRateModel.address
    // );
    // //support USDC market
    // alkemiEarnVerified._supportMarket(
    // 	deploymentConfig.RINKEBY.USDC,
    // 	deploymentConfig.RINKEBY.USDC_RATE_MODEL
    // );
    await alkemiEarnPublic.setRewardControlAddress(rewardControl.address);
    // alkemiEarnVerified._supportMarket(
    // 	alkWETH.address,
    //  	BTCRateModel.address
    // );
    //support DAI market
    /*	alkemiEarnVerified._supportMarket(
		   deploymentConfig.RINKEBY.DAI,
			deploymentConfig.RINKEBY.DAI_RATE_MODEL
	   );
	   //support WBTC market
	   alkemiEarnVerified._supportMarket(
		   deploymentConfig.RINKEBY.WBTC,
			deploymentConfig.RINKEBY.WBTC_RATE_MODEL
	   );
	   //support WETH market
	   alkemiEarnVerified._supportMarket(
		   alkWETH.address,
			deploymentConfig.RINKEBY.WETH_RATE_MODEL
	   );
		   
	   
	   await alkemiEarnPublic.setRewardControlAddress(rewardControl.address);
	   */
  }
};

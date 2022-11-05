const { ethers } = require("hardhat");
const { expect } = require("chai");

describe("Compound", () => {
  it("Should be able to mint/redeem with ERC20 token", async () => {
    const [owner] = await ethers.getSigners();

    // deploy Comptroller
    const comptrollerFactory = await ethers.getContractFactory("Comptroller");
    const comptroller = await comptrollerFactory.deploy();
    await comptroller.deployed();

    // deploy SimplePriceOracle
    const simplePriceOracleFactory = await ethers.getContractFactory(
      "SimplePriceOracle"
    );
    const simplePriceOracle = await simplePriceOracleFactory.deploy();
    await simplePriceOracle.deployed();

    // setup price oracle
    await comptroller._setPriceOracle(simplePriceOracle.address);

    // 部署一個 CErc20 的 underlying ERC20 token，decimals 為 18
    const testErc20Factory = await ethers.getContractFactory("TestErc20");
    const testErc20 = await testErc20Factory.deploy(
      ethers.utils.parseUnits("10000", 18),
      "My Token",
      "myToken"
    );
    await testErc20.deployed();

    // deploy WhitePaperInterestRateModel, 將利率模型合約中的借貸利率設定為 0%
    const whitePaperInterestRateModelFactory = await ethers.getContractFactory(
      "WhitePaperInterestRateModel"
    );
    const whitePaperInterestRateModel =
      await whitePaperInterestRateModelFactory.deploy(
        ethers.utils.parseUnits("0", 18), // baseRatePerYear = 0
        ethers.utils.parseUnits("0", 18) // multiplierPerYear = 0
      );
    await whitePaperInterestRateModel.deployed();

    // 部署一個 CErc20
    const testCErc20Factory = await ethers.getContractFactory("TestCErc20");
    const testCErc20 = await testCErc20Factory.deploy();
    await testCErc20.deployed();

    // initialize CErc20, 因為有重複的initialize, 需要寫成function signature
    await testCErc20[
      "initialize(address,address,address,uint256,string,string,uint8)"
    ](
      testErc20.address,
      comptroller.address,
      whitePaperInterestRateModel.address,
      ethers.utils.parseUnits("1", 18), // 初始 exchangeRate 為 1:1
      "My CToken",
      "myCToken",
      18 // CToken 的 decimals 為 18
    );

    // support testCErc20 market
    await comptroller._supportMarket(testCErc20.address);

    // owner mint 100 testCErc20 token with testErc20 token
    const MINT_AMOUNT = ethers.utils.parseUnits("100", 18);
    await testErc20.approve(testCErc20.address, MINT_AMOUNT); // 允許testCErc20合約地址轉出owner的100個testErc20 token
    await testCErc20.mint(MINT_AMOUNT); // owner開始mint 100 個 testCErc20 token

    // CErc20合約裡應該要收到100個testErc20 token
    let erc20BalanceOfCErc20Contract = await testErc20.balanceOf(
      testCErc20.address
    );
    expect(erc20BalanceOfCErc20Contract).to.equal(MINT_AMOUNT);

    // owner應該收到100個testCErc20 token
    let testCErc20BalanceOfOwner = await testCErc20.balanceOf(owner.address);
    expect(testCErc20BalanceOfOwner).to.equal(MINT_AMOUNT);

    // owner redeem 100 testErc20 token with testCErc20 token
    await testCErc20.redeem(MINT_AMOUNT);

    // testCErc20合約的testErc20 token餘額應該為0
    erc20BalanceOfCErc20Contract = await testErc20.balanceOf(
      testCErc20.address
    );
    expect(erc20BalanceOfCErc20Contract).to.equal(0);

    // owner的testCErc20 token餘額應該是0，因為全部redeem了
    testCErc20BalanceOfOwner = await testCErc20.balanceOf(owner.address);
    expect(testCErc20BalanceOfOwner).to.equal(0);
  });
});

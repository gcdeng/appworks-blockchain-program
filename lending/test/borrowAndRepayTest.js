const { ethers } = require("hardhat");
const { expect } = require("chai");

describe("Compound", () => {
  it("Should be able to borrow and repay", async () => {
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

    // deploy ERC20 tokenA
    const TOTAL_TOKEN_A = ethers.utils.parseUnits("10000", 18);
    const testErc20Factory = await ethers.getContractFactory("TestErc20");
    const tokenA = await testErc20Factory.deploy(
      TOTAL_TOKEN_A,
      "tokenA",
      "tokenA"
    );
    await tokenA.deployed();

    // deploy ERC20 tokenB
    const TOTAL_TOKEN_B = TOTAL_TOKEN_A;
    const tokenB = await testErc20Factory.deploy(
      TOTAL_TOKEN_B,
      "tokenB",
      "tokenB"
    );
    await tokenB.deployed();

    // deploy cERC20 cTokenA
    const testCErc20Factory = await ethers.getContractFactory("TestCErc20");
    const cTokenA = await testCErc20Factory.deploy();
    await cTokenA.deployed();

    await cTokenA[
      "initialize(address,address,address,uint256,string,string,uint8)"
    ](
      tokenA.address,
      comptroller.address,
      whitePaperInterestRateModel.address,
      ethers.utils.parseUnits("1", 18), // 初始 exchangeRate 為 1:1
      "cTokenA",
      "cTokenA",
      18 // CToken 的 decimals 為 18
    );

    // deploy cERC20 cTokenB
    const cTokenB = await testCErc20Factory.deploy();
    await cTokenB.deployed();

    await cTokenB[
      "initialize(address,address,address,uint256,string,string,uint8)"
    ](
      tokenB.address,
      comptroller.address,
      whitePaperInterestRateModel.address,
      ethers.utils.parseUnits("1", 18), // 初始 exchangeRate 為 1:1
      "cTokenB",
      "cTokenB",
      18 // CToken 的 decimals 為 18
    );

    // support market
    await comptroller._supportMarket(cTokenA.address);
    await comptroller._supportMarket(cTokenB.address);

    // 在 Oracle 中設定一顆 token A 的價格為 $1，一顆 token B 的價格為 $100
    await simplePriceOracle.setUnderlyingPrice(
      cTokenA.address,
      ethers.utils.parseUnits("1", 18)
    );
    await simplePriceOracle.setUnderlyingPrice(
      cTokenB.address,
      ethers.utils.parseUnits("100", 18)
    );

    // 將 Token B 的 collateral factor 設為 50%
    await comptroller._setCollateralFactor(
      cTokenB.address,
      ethers.utils.parseUnits("0.5", 18)
    );

    // mint 1 cTokenB
    const TOKEN_B_MINT_AMOUNT = ethers.utils.parseUnits("1", 18);
    await tokenB.approve(cTokenB.address, TOKEN_B_MINT_AMOUNT); // 允許 cTokenB 合約地址轉出owner的1個 tokenB
    await cTokenB.mint(TOKEN_B_MINT_AMOUNT); // owner mint 1 個 cTokenB

    // mint 100 cTokenA
    const TOKEN_A_MINT_AMOUNT = ethers.utils.parseUnits("100", 18);
    await tokenA.approve(cTokenA.address, TOKEN_A_MINT_AMOUNT);
    await cTokenA.mint(TOKEN_A_MINT_AMOUNT); // owner mint 1 個 cTokenB

    // owner將cTokenB作為抵押品
    await comptroller.enterMarkets([cTokenB.address]);
    const assets = await comptroller.getAssetsIn(owner.address);
    expect(assets).to.eqls([cTokenB.address]);

    // 借 50 個 TokenA
    const TOKEN_A_BORROW_AMOUNT = ethers.utils.parseUnits("50", 18);
    const borrowResult = await cTokenA.borrow(TOKEN_A_BORROW_AMOUNT);
    expect(borrowResult.value).to.equal(0); // 0=success

    // check tokenA balance of owner
    let ownerBalanceOfTokenA = await tokenA.balanceOf(owner.address);
    expect(ownerBalanceOfTokenA).to.equal(ethers.utils.parseUnits("9950", 18));

    // 還 50 個 TokenA
    await tokenA.approve(cTokenA.address, TOKEN_A_BORROW_AMOUNT); // 允許 cTokenA 合約從 owner 轉出 50 個 tokenA
    const repayResult = await cTokenA.repayBorrow(TOKEN_A_BORROW_AMOUNT); // cTokenA call tokenA.transferFrom(owner.address, cTokenA.address, 50) 把 owner 的 50 個 tokenA 轉給自己
    console.log(repayResult);
    expect(repayResult.value).to.equal(0); // 0=success

    // check tokenA balance of owner
    ownerBalanceOfTokenA = await tokenA.balanceOf(owner.address);
    expect(ownerBalanceOfTokenA).to.equal(ethers.utils.parseUnits("9900", 18));
  });
});

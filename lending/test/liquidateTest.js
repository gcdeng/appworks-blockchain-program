const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");

describe("liquidateBorrow", () => {
  /**
   * user1 使用 1 顆 token B 來 mint cToken
   * user2 使用 100 顆 token A 來 mint cToken
   * user1 抵押 tokenB 借出 50 tokenA
   * Token B 的 collateral factor 為 50%
   * close factor = 50%
   * Liquidation Incentive = 108%
   */
  const user1BorrowTokenA = async () => {
    const [owner, user1, user2] = await ethers.getSigners();

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

    // set close factor = 50%, 一次只能清算一半的借款，保護被清算的人
    comptroller._setCloseFactor(ethers.utils.parseUnits("0.5", 18));

    // 設定清算獎勵 = 108%, 清算人可以獲得清算金額的8%作為獎勵
    comptroller._setLiquidationIncentive(ethers.utils.parseUnits("1.08", 18));

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

    // owner 轉 tokenA 給 user2
    await tokenA.transfer(user2.address, ethers.utils.parseUnits("1000", 18));

    // owner 轉 tokenB 給 user1
    await tokenB.transfer(user1.address, ethers.utils.parseUnits("1000", 18));

    // user1 mint 1 cTokenB
    const TOKEN_B_MINT_AMOUNT = ethers.utils.parseUnits("1", 18);
    await tokenB.connect(user1).approve(cTokenB.address, TOKEN_B_MINT_AMOUNT); // 允許 cTokenB 合約地址轉出 user1 的1個 tokenB
    await cTokenB.connect(user1).mint(TOKEN_B_MINT_AMOUNT);

    // user2 mint 100 cTokenA
    const TOKEN_A_MINT_AMOUNT = ethers.utils.parseUnits("100", 18);
    await tokenA.connect(user2).approve(cTokenA.address, TOKEN_A_MINT_AMOUNT);
    await cTokenA.connect(user2).mint(TOKEN_A_MINT_AMOUNT);

    // user1 將 cTokenB 作為抵押品
    await comptroller.connect(user1).enterMarkets([cTokenB.address]);
    const assetsOfUser1 = await comptroller.getAssetsIn(user1.address);
    expect(assetsOfUser1).to.eqls([cTokenB.address]);

    // user1 借 50 個 TokenA，因為collateral factor 是 50%，最多也只能借50個
    const TOKEN_A_BORROW_AMOUNT = ethers.utils.parseUnits("50", 18);
    const borrowResult = await cTokenA
      .connect(user1)
      .borrow(TOKEN_A_BORROW_AMOUNT);

    expect(borrowResult.value).to.equal(0); // 0=success

    // check tokenA balance of user1 成功借到 50 tokenA
    expect(await tokenA.balanceOf(user1.address)).to.equal(
      ethers.utils.parseUnits("50", 18)
    );

    return {
      comptroller,
      simplePriceOracle,
      tokenA,
      cTokenA,
      cTokenB,
      user1,
      user2,
    };
  };

  it("user2 liquidate user1 after decrease collateral factor", async () => {
    // 延續 (3.) 的借貸場景，調整 token A 的 collateral factor，讓 user1 被 user2 清算
    const { comptroller, tokenA, cTokenA, cTokenB, user1, user2 } =
      await loadFixture(user1BorrowTokenA);

    // 將 Token B 的 collateral factor 降低為 20%，user1變成最多只能借20個tokenA，因此可以被清算
    await comptroller._setCollateralFactor(
      cTokenB.address,
      ethers.utils.parseUnits("0.2", 18)
    );

    // user2 清算 user1, 清算金額 = 50 * 50%(close factor) = 25 tokenA
    const REPAY_AMOUNT = ethers.utils.parseUnits("25", 18);
    await tokenA.connect(user2).approve(cTokenA.address, REPAY_AMOUNT);
    await expect(
      cTokenA
        .connect(user2)
        .liquidateBorrow(user1.address, REPAY_AMOUNT, cTokenB.address)
    ).to.changeTokenBalances(
      tokenA,
      [cTokenA, user2],
      [REPAY_AMOUNT, ethers.utils.parseUnits("-25", 18)]
    );

    // 檢查 user2 獲得的 cTokenB = (清算金額 * 清算獎勵 - compound抽成2.8%)/tokenB價格
    const user2BalanceOfCTokenB = await cTokenB.balanceOf(user2.address);
    const expectValue = (25 * 1.08 * (1 - 0.028)) / 100;
    expect(user2BalanceOfCTokenB).to.equal(
      ethers.utils.parseUnits(`${expectValue}`, 18)
    );
  });

  it("user2 liquidate user1 after decrease tokenB (collateral) price", async () => {
    // 延續 (3.) 的借貸場景，調整 oracle 中的 token B 的價格，讓 user1 被 user2 清算
    const { simplePriceOracle, tokenA, cTokenA, cTokenB, user1, user2 } =
      await loadFixture(user1BorrowTokenA);

    // 將 tokenB 的價格設為原本的一半，變成只能借出25 tokenA，已借出50 tokenA，所以可以被清算了
    const newTokenBPrice = 50;
    await simplePriceOracle.setUnderlyingPrice(
      cTokenB.address,
      ethers.utils.parseUnits(`${newTokenBPrice}`, 18)
    );

    // user2 清算 user1, 清算金額 = 50 * 50%(close factor) = 25 tokenA
    const REPAY_AMOUNT = ethers.utils.parseUnits("25", 18);
    await tokenA.connect(user2).approve(cTokenA.address, REPAY_AMOUNT);
    await expect(
      cTokenA
        .connect(user2)
        .liquidateBorrow(user1.address, REPAY_AMOUNT, cTokenB.address)
    ).to.changeTokenBalances(
      tokenA,
      [cTokenA, user2],
      [REPAY_AMOUNT, ethers.utils.parseUnits("-25", 18)]
    );

    // 檢查 user2 獲得的 cTokenB = (清算金額 * 清算獎勵 - compound抽成2.8%)/tokenB價格
    const user2BalanceOfCTokenB = await cTokenB.balanceOf(user2.address);
    const expectValue = (25 * 1.08 * (1 - 0.028)) / newTokenBPrice;
    expect(user2BalanceOfCTokenB).to.equal(
      ethers.utils.parseUnits(`${expectValue}`, 18)
    );
  });
});

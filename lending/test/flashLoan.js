const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const {
  impersonateAccount,
} = require("@nomicfoundation/hardhat-network-helpers");

const parseUnits = ethers.utils.parseUnits;

const abi = new ethers.utils.AbiCoder();

// USDC contract address
const usdcContractAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const uniContractAddress = "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984";
const binanceHotWalletAddress = "0xF977814e90dA44bFA03b6295A0616a897441aceC";
const BASE_DECIMALS = 18;
const USDC_DECIMALS = 6;
const uniCollateralAmount = parseUnits("1000", BASE_DECIMALS); // user1 使用 1000 顆 UNI 作為抵押品
const usdcBorrowAmount = parseUnits("5000", USDC_DECIMALS); // user1 借出 5000 USDC
const AAVE_LENDING_POOL_ADDRESS_PROVIDER =
  "0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5";
const UNISWAP_V3_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564";

/**
 * 請使用 Hardhat 的 fork 模式撰寫測試，並使用 AAVE 的 Flash loan 來清算 user1，請遵循以下細節：
 * Fork Ethereum mainnet at block 15815693 (Reference)
 * cToken 的 decimals 皆為 18，初始 exchangeRate 為 1:1
 * Close factor 設定為 50%
 * Liquidation incentive 設為 8%（1.01 * 1e18)
 * 使用 USDC 以及 UNI 代幣來作為 token A 以及 Token B
 * 在 Oracle 中設定 USDC 的價格為 $1，UNI 的價格為 $10
 * 設定 UNI 的 collateral factor 為 50%
 * User1 使用 1000 顆 UNI 作為抵押品借出 5000 顆 USDC
 * 將 UNI 價格改為 $6.2 使 User1 產生 Shortfall，並讓 User2 透過 AAVE 的 Flash loan 來清算 User1
 * 可以自行檢查清算 50% 後是不是大約可以賺 121 USD
 */
describe("liquidate borrow from COMPOUND by using AAVE flash loan", () => {
  const setupCompound = async () => {
    const [owner, user1, user2] = await ethers.getSigners(); // user1 = borrower 借款人 (將會被清算的人), user2 = liquidator 清算者
    await impersonateAccount(binanceHotWalletAddress);
    const binanceWallet = await ethers.getSigner(binanceHotWalletAddress); // impersonate CZ

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
    comptroller._setCloseFactor(parseUnits("0.5", BASE_DECIMALS));

    // 設定清算獎勵 = 108%, 清算人可以獲得清算金額的8%作為獎勵
    comptroller._setLiquidationIncentive(parseUnits("1.08", BASE_DECIMALS));

    // deploy WhitePaperInterestRateModel, 將利率模型合約中的借貸利率設定為 0%
    const whitePaperInterestRateModelFactory = await ethers.getContractFactory(
      "WhitePaperInterestRateModel"
    );
    const whitePaperInterestRateModel =
      await whitePaperInterestRateModelFactory.deploy(
        ethers.utils.parseUnits("0", BASE_DECIMALS), // baseRatePerYear = 0
        ethers.utils.parseUnits("0", BASE_DECIMALS) // multiplierPerYear = 0
      );
    await whitePaperInterestRateModel.deployed();

    // get ERC20 token from forking mainnet, 使用 USDC 以及 UNI 代幣來作為 token A 以及 Token B
    const usdcToken = await ethers.getContractAt("ERC20", usdcContractAddress);
    const uniToken = await ethers.getContractAt("ERC20", uniContractAddress);

    // deploy cERC20 cUsdc
    const testCErc20Factory = await ethers.getContractFactory("TestCErc20");
    const cUsdc = await testCErc20Factory.deploy();
    await cUsdc.deployed();

    await cUsdc[
      "initialize(address,address,address,uint256,string,string,uint8)"
    ](
      usdcToken.address,
      comptroller.address,
      whitePaperInterestRateModel.address,
      parseUnits("1", USDC_DECIMALS), // 初始 exchangeRate 為 1:1, 注意：USDC decimals = 6, 1 * 10^(18 - 18 + 6), reference: https://docs.compound.finance/v2/ctokens/#exchange-rate
      "cUsdc",
      "cUsdc",
      18 // CToken 的 decimals 為 18
    );

    // deploy cERC20 cUni
    const cUni = await testCErc20Factory.deploy();
    await cUni.deployed();

    await cUni[
      "initialize(address,address,address,uint256,string,string,uint8)"
    ](
      uniToken.address,
      comptroller.address,
      whitePaperInterestRateModel.address,
      parseUnits("1", BASE_DECIMALS), // 初始 exchangeRate 為 1:1
      "cUni",
      "cUni",
      18 // CToken 的 decimals 為 18
    );

    // support market
    await comptroller._supportMarket(cUsdc.address);
    await comptroller._supportMarket(cUni.address);

    // 在 Oracle 中設定 USDC 的價格為 $1，UNI 的價格為 $10
    await simplePriceOracle.setUnderlyingPrice(
      cUsdc.address,
      parseUnits("1", 18 + 18 - 6) // 因為USDC decimals = 6, 這邊要補上 USDC 少的 18 - 6 個位數, reference: https://docs.compound.finance/v2/prices/#underlying-price
    );

    await simplePriceOracle.setUnderlyingPrice(
      cUni.address,
      parseUnits("10", BASE_DECIMALS)
    );

    // 設定 UNI 的 collateral factor 為 50%
    await comptroller._setCollateralFactor(
      cUni.address,
      ethers.utils.parseUnits("0.5", 18)
    );

    return {
      comptroller,
      simplePriceOracle,
      usdcToken,
      uniToken,
      cUsdc,
      cUni,
      owner,
      user1,
      user2,
      binanceWallet,
    };
  };

  it("user2 liquidate user1 by using flash loan", async () => {
    const {
      cUsdc,
      usdcToken,
      cUni,
      uniToken,
      user1,
      user2,
      binanceWallet,
      comptroller,
      simplePriceOracle,
    } = await loadFixture(setupCompound);

    // binance mint 5000 cUsdc, supply 5000 USDC to compound
    await usdcToken
      .connect(binanceWallet)
      .approve(cUsdc.address, usdcBorrowAmount);
    await cUsdc.connect(binanceWallet).mint(usdcBorrowAmount);

    // transfer 1000 UNI to user1 from binance
    await uniToken
      .connect(binanceWallet)
      .transfer(user1.address, uniCollateralAmount);

    // user1 mint 1000 cUNI
    await uniToken.connect(user1).approve(cUni.address, uniCollateralAmount);
    await cUni.connect(user1).mint(uniCollateralAmount);

    // user1 將 1000 cUni 作為抵押品
    await comptroller.connect(user1).enterMarkets([cUni.address]);

    // User1 使用 1000 顆 UNI 作為抵押品借出 5000 顆 USDC
    const borrowResult = await cUsdc.connect(user1).borrow(usdcBorrowAmount);

    expect(borrowResult.value).to.equal(0); // 0=success

    // 檢查 user1 有借到 5000 USDC
    expect(await usdcToken.balanceOf(user1.address)).to.equal(usdcBorrowAmount);

    // //將 UNI 價格改為 $6.2 使 User1 產生 Shortfall
    await simplePriceOracle.setUnderlyingPrice(
      cUni.address,
      parseUnits("6.2", BASE_DECIMALS)
    );

    // 檢查 shortfall 應該等於 5000 - (1000 * 6.2 / 2) = 1900
    const result = await comptroller.getAccountLiquidity(user1.address);
    const shortfall = result[2];
    expect(shortfall).to.eq(parseUnits("1900", BASE_DECIMALS));

    // 計算可清算金額 = 5000(借款) * 50%(close factor) = 2500 USDC
    const repayAmount = parseUnits("2500", USDC_DECIMALS);

    // deploy flash loan receiver contract
    const myV2FlashLoanFactory = await ethers.getContractFactory(
      "MyV2FlashLoan"
    );
    const myV2FlashLoan = await myV2FlashLoanFactory.deploy(
      AAVE_LENDING_POOL_ADDRESS_PROVIDER,
      UNISWAP_V3_ROUTER
    );
    await myV2FlashLoan.deployed();

    // user2 call LENDING_POOL flashLoan function 透過 AAVE 的 Flash loan 借出 USDC 之後 執行 executeOperation 來清算 User1，executeOperation 中實現清算邏輯
    const receiverAddress = myV2FlashLoan.address;
    await myV2FlashLoan.connect(user2).myFlashLoanCall(
      receiverAddress, // 跟 flash loan 借到的錢要送到的合約地址，執行 executeOperation function 的合約
      [usdcToken.address], // 跟 flash loan 借的資產: USDC
      [repayAmount.toString()], // 跟 flash loan 借的金額: 2500
      [0],
      receiverAddress,
      abi.encode(
        ["address", "address", "address", "address"],
        [user1.address, cUsdc.address, cUni.address, uniToken.address]
      ), // executeOperation 裡面拿到借款2500之後開始清算user2需要用到的參數
      0
    );

    // 檢查清算 50% 後是不是大約可以賺 121 USD
    const reward = await usdcToken.balanceOf(myV2FlashLoan.address);
    console.log(reward); // 121739940
  });
});

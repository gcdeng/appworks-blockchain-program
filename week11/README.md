# appworks-blockchain-program-week11

<https://github.com/AppWorks-School/Blockchain-Resource/blob/main/section3/lending.md>

## 目的：理解區塊鏈的借貸協議怎麼做，以及閃電貸怎麼使用

請賞析 [Compound](https://docs.compound.finance/v2/) 的合約，並依序實作以下

1. 在 Hardhat 的 test 中部署一個 CErc20(`CErc20.sol`)，一個 Comptroller(`Comptroller.sol`) 以及合約初始化時相關必要合約，請遵循以下細節：
   - CToken 的 decimals 皆為 18
   - 需部署一個 CErc20 的 underlying ERC20 token，decimals 為 18
   - 使用 `SimplePriceOracle` 作為 Oracle
   - 將利率模型合約中的借貸利率設定為 0%
   - 初始 exchangeRate 為 1:1
   - 進階(Optional)： 使用 Compound 的 Proxy 合約（`CErc20Delegator.sol` and `Unitroller.sol`)
2. 讓 user1 mint/redeem CErc20，請透過 Hardhat test case 實現以下場景
   - User1 使用 100 顆（100 \* 10^18） ERC20 去 mint 出 100 CErc20 token，再用 100 CErc20 token redeem 回 100 顆 ERC20

## test

```sh
yarn
npx hardhat test ./test/mintAndRedeemTest.js
```

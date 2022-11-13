// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.10;

import { FlashLoanReceiverBase } from "./FlashLoanReceiverBase.sol";
import { ILendingPool } from "./ILendingPool.sol";
import { ILendingPoolAddressesProvider } from "./ILendingPoolAddressesProvider.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { CErc20 } from 'compound-protocol/contracts/CErc20.sol';
import { ISwapRouter } from '@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol';

import 'hardhat/console.sol';
/** 
    !!!
    Never keep funds permanently on your FlashLoanReceiverBase contract as they could be 
    exposed to a 'griefing' attack, where the stored funds are used by an attacker.
    !!!
 */
contract MyV2FlashLoan is FlashLoanReceiverBase {
    ISwapRouter public immutable swapRouter;

    constructor(
        ILendingPoolAddressesProvider _provider,
        ISwapRouter _swapRouter
    ) FlashLoanReceiverBase(_provider) {
        swapRouter = ISwapRouter(_swapRouter);
    }

    function myFlashLoanCall(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata modes,
        address onBehalfOf,
        bytes calldata params,
        uint16 referralCode
    ) external {
        LENDING_POOL.flashLoan(
            receiverAddress,
            assets,
            amounts,
            modes,
            onBehalfOf,
            params,
            referralCode
        );
    }

    /**
        This function is called after your contract has received the flash loaned amount
     */
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    )
        external
        override
        returns (bool)
    {

        //
        // This contract now has the funds requested.
        // Your logic goes here.
        // 實現compound清算邏輯，清算完成獲得抵押品UNI之後透過Uniswap換成USDC還錢給AAVE flash loan lending pool

        (
			address borrower,
			address cUsdc,
			address cUni,
			address uniToken
		) = abi.decode(params, (address, address, address, address));

        address usdcToken = assets[0]; // 跟 flashloan 借的資產: USDC
        uint256 repayAmount = amounts[0]; // 跟 flashloan 借的金額: 2500

        // 用flashload所得到的 2500 USDC 清算 borrower (user1)
        IERC20(usdcToken).approve(cUsdc, repayAmount);
        CErc20(cUsdc).liquidateBorrow(borrower, repayAmount, CErc20(cUni));

        // 把清算獲得的cUni抵押品都換回UNI
        CErc20(cUni).redeem(CErc20(cUni).balanceOf(address(this)));

        // 總共獲得的UNI
        uint256 uniAmount = IERC20(uniToken).balanceOf(address(this));
        // console.log(uniAmount); // 423290322580645161290

        // 允許 uniswap router 使用 UNI
        IERC20(uniToken).approve(address(swapRouter), uniAmount);

        // 將 UNI 兌換成 USDC，然後轉到這個合約裡
        ISwapRouter.ExactInputSingleParams memory swapParams =
        ISwapRouter.ExactInputSingleParams({
            tokenIn: uniToken,
            tokenOut: usdcToken,
            fee: 3000, // 0.3%
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: uniAmount,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0
        });

        // The call to `exactInputSingle` executes the swap.
        // 0xE592427A0AEce92De3Edee1F18E0157C05861564
        uint256 amountOut = swapRouter.exactInputSingle(swapParams); // UNI 兌換到的 USDC = 2623989940

        
        // At the end of your logic above, this contract owes
        // the flashloaned amounts + premiums.
        // Therefore ensure your contract has enough to repay
        // these amounts.
        
        // Approve the LendingPool contract allowance to *pull* the owed amount
        
        uint amountOwing = repayAmount + premiums[0]; // premiums[0] 是 flashloan 的利息 2500000000 * 0.09% = 2250000，amountOwing 是連本帶利該還給 flashloan 的金額 = 2502250000
        // console.log(amountOut - amountOwing); // 最後賺到的錢: 2623989940 = 2502250000 = 121739940 大約等於 121 USD
        if(amountOut >= amountOwing) {
            IERC20(usdcToken).approve(address(LENDING_POOL), amountOwing); // 允許錢可以轉去 LendingPool contract
        }
        
        return true;
    }
}
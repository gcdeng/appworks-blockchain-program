// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestErc20 is ERC20 {
    constructor(uint256 supply, string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, supply);
    }
}
require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

const ALCHEMY_KEY = process.env.ALCHEMY_KEY;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.10",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      forking: {
        url: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
        blockNumber: 15815693,
        enabled: true,
      },
    },
  },
};

# Alkemi Earn Contracts

[![MythXBadge](https://badgen.net/https/api.mythx.io/v1/projects/bdc732b7-27d2-4a17-be68-0a1f842ed64b/badge/data?cache=300&icon=https://raw.githubusercontent.com/ConsenSys/mythx-github-badge/main/logo_white.svg)](https://docs.mythx.io/dashboard/github-badges)

> Implementation of Alkemi Earn Contracts in Solidity. [earn.alkemi.network](https://earn.alkemi.network/)

## Table of Contents

* [Get Started](./#get-started)
  * [Local development](./#local-development)
* [Testing](./#testing)
  * [Code Linting](./#code-linting)
* [Networks](./#networks)
  * [Mainnets](./#mainnet-deployments)
    * [Ethereum Mainnet](./#ethereum-mainnet)
* [Documentation](./#documentation)
* [Issues](./#issues)

## Get Started

For local development of `alkemi-earn-contracts` you can setup the development environment on your machine.

### Local development

For local development it is recommended to use [ganache](http://truffleframework.com/ganache/) to run a local development chain. Using the ganache simulator no full Ethereum node is required.

As a pre-requisite, you need:

* Node.js
* npm

Clone the project and install all dependencies:

```text
git clone git@github.com:AlkemiNetwork/alkemi-earn-contracts.git
cd alkemi-earn-contracts/

# install project dependencies
$ npm i
```

Compile the solidity contracts:

```text
$ npm run compile
```

![](https://raw.githubusercontent.com/AlkemiNetwork/alkemi-reserve-contracts/master/docs/assets/alk-compile.gif)

In a new terminal, launch an Ethereum RPC client, we use the default ganache-cli command to configure and run a local development ganache:

```text
$ npm run ganache
```

Switch back to your other terminal and deploy the contracts:

```text
$ npm run deploy
```

## Testing

Run tests with:

```text
$ truffle test
```

### Code Linting

Linting is setup for `JavaScript` with [ESLint](https://eslint.org) & Solidity with [Solhint](https://protofire.github.io/solhint/) and [Prettier](https://prettier.io/).

```text
# lint solidity contracts
$ npm run prettier:contracts

# lint tests
$ npm run lint:tests
```

Code style is enforced through the CI test process, builds will fail if there're any linting errors.

## Networks

### Testnet Deployments

#### Rinkeby Testnet

| Contract Name | Contract Address |
| :--- | :--- |
|  Alkemi Earn Verified |  0xa3ae4956151c3027Ae47E4d899C712Ac3C427550 |
|  Alkemi Earn Public |  0xAf6cEd6708DF2617aCB974C23C422C3F7BC8A69F |
|  Reward control |  0xAe3997162526c6583b747B811cb6cD359cC5e0a6 |
|  Price Oracle |  0xa58D3C9A39402Dc17Ac3E413C7B87c94F11eFFeb |

## Documentation

* [Contracts Documentation](https://docs.alkemi.network/earn-contracts)

## Issues

If you come across an issue with Alkemi Protocol contracts, do a search in the [Issues](https://github.com/AlkemiNetwork/alkemi-earn-contracts/issues) tab of this repo to make sure it hasn't been reported before. Follow these steps to help us prevent duplicate issues and unnecessary notifications going to the many people watching this repo:

* If the issue you found has been reported and is still open, and the details match your issue, give a "thumbs up" to the relevant posts in the issue thread to signal that you have the same issue. No further action is required on your part.
* If the issue you found has been reported and is still open, but the issue is missing some details, you can add a comment to the issue thread describing the additional details.
* If the issue you found has been reported but has been closed, you can comment on the closed issue thread and ask to have the issue reopened because you are still experiencing the issue. Alternatively, you can open a new issue, reference the closed issue by number or link, and state that you are still experiencing the issue. Provide any additional details in your post so we can better understand the issue and how to fix it.


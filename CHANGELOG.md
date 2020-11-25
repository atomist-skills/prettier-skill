# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).

## [Unreleased](https://github.com/atomist-skills/prettier-skill/compare/1.0.1...HEAD)

### Changed

-   Allow prettier configuration to be set in non-npm projects. [#112](https://github.com/atomist-skills/prettier-skill/issues/112)

## [1.0.1](https://github.com/atomist-skills/prettier-skill/compare/1.0.0...1.0.1) - 2020-11-19

### Removed

-   Remove validation for matching files. [2ca7d53](https://github.com/atomist-skills/prettier-skill/commit/2ca7d53fcdddab72062bb0b495fd4270d7103056)

## [1.0.0](https://github.com/atomist-skills/prettier-skill/compare/0.2.0...1.0.0) - 2020-11-17

### Changed

-   Update skill icon. [de65f6b](https://github.com/atomist-skills/prettier-skill/commit/de65f6bf7a87268b4830dd40fe36e0303e1f9e5b)
-   Use type generation in @atomist/skill. [4a4af2b](https://github.com/atomist-skills/prettier-skill/commit/4a4af2bde91a0edc09db73419467f1884f14c48e)

### Removed

-   Remove unused chat provider. [5ec6176](https://github.com/atomist-skills/prettier-skill/commit/5ec6176be792784225e4bc6081bd595b1bc3a3b9)

## [0.2.0](https://github.com/atomist-skills/prettier-skill/compare/0.1.5...0.2.0) - 2020-10-16

### Changed

-   Update skill category. [399aeb1](https://github.com/atomist-skills/prettier-skill/commit/399aeb16840d14049988e5dbeea14bb57d5dcfa9)

## [0.1.5](https://github.com/atomist-skills/prettier-skill/compare/0.1.4...0.1.5) - 2020-10-14

### Added

-   Preserve spacing in package.json when updating dependencies. [#72](https://github.com/atomist-skills/prettier-skill/issues/72)

### Fixed

-   Always set commit check status. [#58](https://github.com/atomist-skills/prettier-skill/issues/58)
-   Fix npm casing. [26eaabf](https://github.com/atomist-skills/prettier-skill/commit/26eaabfd54f1d03d875db7f3c115993651516a43)
-   Check return value of project.spawn. [#59](https://github.com/atomist-skills/prettier-skill/issues/59)
-   Consider updating description of Fix problems parameter. [#71](https://github.com/atomist-skills/prettier-skill/issues/71)

## [0.1.4](https://github.com/atomist-skills/prettier-skill/compare/0.1.3...0.1.4) - 2020-07-28

### Changed

-   Update category. [#18](https://github.com/atomist-skills/prettier-skill/issues/18)

## [0.1.3](https://github.com/atomist-skills/prettier-skill/compare/0.1.2...0.1.3) - 2020-07-17

## [0.1.2](https://github.com/atomist-skills/prettier-skill/compare/0.1.1...0.1.2) - 2020-07-16

### Added

-   Add configuration support. [6c0792a](https://github.com/atomist-skills/prettier-skill/commit/6c0792a02df9813a584c74e70fffe6803d7eee88)

## [0.1.1](https://github.com/atomist-skills/prettier-skill/compare/0.1.0...0.1.1) - 2020-07-16

### Changed

-   Ignore generated branches. [c9cc527](https://github.com/atomist-skills/prettier-skill/commit/c9cc527ee9958b942c976567b623d1125bc95b25)

### Fixed

-   Fix extra line breaks in prettier output. [7eb410c](https://github.com/atomist-skills/prettier-skill/commit/7eb410c21cf185d46b249a0ea8b97c82322c4e07)

## [0.1.0](https://github.com/atomist-skills/prettier-skill/tree/0.1.0) - 2020-07-06

### Added

-   Initial version. [0d5c4d9](https://github.com/atomist-skills/prettier-skill/commit/0d5c4d90acb24e3b8bcf5c7438d71178eeb770bc)
-   Add support for .prettierignore. [#3](https://github.com/atomist-skills/prettier-skill/issues/3)
-   Add support running prettier on non NPM projects. [#6](https://github.com/atomist-skills/prettier-skill/issues/6)

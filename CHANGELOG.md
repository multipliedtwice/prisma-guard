# [1.18.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.17.0...v1.18.0) (2026-04-20)


### Bug Fixes

* **model-guard.test.ts:** update test assertions to match expected data shape for id to simplify the comparison logic ([36825e7](https://github.com/multipliedtwice/prisma-guard/commit/36825e752508464b73912c828899d6ce0824a48e))


### Features

* **model-guard.ts:** add normalizeUniqueWhere function to simplify unique where conditions and improve code readability ([afac21b](https://github.com/multipliedtwice/prisma-guard/commit/afac21b43a59675fe5bbaa0ce5d71bbbdb03420f))

# [1.17.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.16.0...v1.17.0) (2026-04-20)


### Features

* **query-builder:** enhance JSON support in query builder with new operators and compatibility checks ([69f4630](https://github.com/multipliedtwice/prisma-guard/commit/69f4630bb6ab801b57a1d91b7bf0a1de28875935))

# [1.16.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.15.0...v1.16.0) (2026-04-20)


### Features

* **scalar-base.ts:** enhance scalar type handling with string and number transformations for String, Int, and Float ([f4c10cb](https://github.com/multipliedtwice/prisma-guard/commit/f4c10cbbf7a0d2a037589fca6c0f233a59c12555))

# [1.15.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.14.1...v1.15.0) (2026-04-20)


### Features

* **constants.ts:** add unsupported marker and related functions to handle unsupported values ([264fc98](https://github.com/multipliedtwice/prisma-guard/commit/264fc98a07bcabf38dce63288e3ef8fa569dafad))

## [1.14.1](https://github.com/multipliedtwice/prisma-guard/compare/v1.14.0...v1.14.1) (2026-04-20)


### Bug Fixes

* force version bump ([0637501](https://github.com/multipliedtwice/prisma-guard/commit/06375012d98e03e9ddaf41c905c1937b791d615b))

# [1.14.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.13.1...v1.14.0) (2026-04-20)


### Features

* **generator:** add support for unsupported field kind in type map generation ([a4202df](https://github.com/multipliedtwice/prisma-guard/commit/a4202dfd98e977f455f6c3d3f16bafd36dba4421))

## [1.13.1](https://github.com/multipliedtwice/prisma-guard/compare/v1.13.0...v1.13.1) (2026-04-20)


### Bug Fixes

* improve error message for deleteMany config and enhance schema validation ([31c1a01](https://github.com/multipliedtwice/prisma-guard/commit/31c1a01795bccc5605a139c9ad6e23e24cfb9731))

# [1.13.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.12.0...v1.13.0) (2026-04-20)


### Features

* enhance upsert validation logic for to-many and to-one relationships ([3dc6fb1](https://github.com/multipliedtwice/prisma-guard/commit/3dc6fb193fc17d5d06fd77ccd29f944a9c05ce0f))

# [1.12.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.11.0...v1.12.0) (2026-04-20)


### Features

* enhance relation handling in data schema with new validation and schema building functions ([5a6d5ed](https://github.com/multipliedtwice/prisma-guard/commit/5a6d5eda023d97f62cbf78954422a3d10c9c1961))

# [1.11.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.10.0...v1.11.0) (2026-04-20)


### Features

* update createWhereBuilder to use equalsBase directly in fieldSchemas ([487d53a](https://github.com/multipliedtwice/prisma-guard/commit/487d53adb19c776f75f4fb2043fccc774d68050c))

# [1.10.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.9.1...v1.10.0) (2026-04-19)


### Features

* enhance createWhereBuilder to support scalar shorthand values and improve operator validation ([0c47c1b](https://github.com/multipliedtwice/prisma-guard/commit/0c47c1b8940ca3df0fb00858b101f04cdf94fb42))
* integrate coerceToArray utility for improved array handling in query builders and schemas ([83b1861](https://github.com/multipliedtwice/prisma-guard/commit/83b1861819a2410b1d70243c9c85a16dbb20dffc))
* simplify operator validation in createWhereBuilder by removing redundant checks ([ab5b15d](https://github.com/multipliedtwice/prisma-guard/commit/ab5b15d1c1cc50a9b4b7a175e0e1b7a8ff34e155))

## [1.9.1](https://github.com/multipliedtwice/prisma-guard/compare/v1.9.0...v1.9.1) (2026-04-19)


### Bug Fixes

* **model-guard.ts, query-builder.ts, query-builder-forced.ts:** remove redundant checks for both "select" and "include" in shape definitions to simplify error handling ([908ad96](https://github.com/multipliedtwice/prisma-guard/commit/908ad96de519b00f876c28e0dde6a721bbd6359a))
* tests ([eb01b8f](https://github.com/multipliedtwice/prisma-guard/commit/eb01b8ff0bd6e96f307ae23636515e06813929a1))
* tests ([3783dc4](https://github.com/multipliedtwice/prisma-guard/commit/3783dc429dccf811dfe48d11a4f34356ceb96022))

# [1.9.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.8.0...v1.9.0) (2026-04-18)


### Features

* **model-guard:** add support for include in projection and selection logic to enhance data retrieval capabilities ([ae601ae](https://github.com/multipliedtwice/prisma-guard/commit/ae601ae8c0d6c9b65fc71bf420677bf456bd52ae))

# [1.8.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.7.0...v1.8.0) (2026-04-18)


### Features

* read schema projection ([d3fa602](https://github.com/multipliedtwice/prisma-guard/commit/d3fa602160761f1dc1202d7f653597a83ed8d051))

# [1.7.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.6.1...v1.7.0) (2026-04-18)


### Bug Fixes

* **query-builder.ts:** cast shape.orderBy to Record<string, OrderByFieldConfig> for type safety in orderBy schema building ([81dffb9](https://github.com/multipliedtwice/prisma-guard/commit/81dffb96c015a6c5059a9ce81918446bb4062cdf))


### Features

* **query-builder.ts, types.ts:** enhance orderBy handling in groupBy to support flexible configurations and improve validation logic ([2276556](https://github.com/multipliedtwice/prisma-guard/commit/227655652f7dfcc5b1545d8aaea17f4a96989922))

## [1.6.1](https://github.com/multipliedtwice/prisma-guard/compare/v1.6.0...v1.6.1) (2026-04-18)


### Bug Fixes

* **query-builder-forced.ts:** simplify where condition handling in applyBuiltShape function for better readability and maintainability ([7509142](https://github.com/multipliedtwice/prisma-guard/commit/75091428f4f6842cd7302ac0813f11a85fc68b95))

# [1.6.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.5.1...v1.6.0) (2026-04-18)


### Features

* **query-builder-forced.ts:** add handling for bodyObj with forcedWhere and missing zodSchema to improve query parsing logic ([1776952](https://github.com/multipliedtwice/prisma-guard/commit/1776952988f801041e93c5029a12949c8351270c))

## [1.5.1](https://github.com/multipliedtwice/prisma-guard/compare/v1.5.0...v1.5.1) (2026-04-18)


### Bug Fixes

* groupBy ([89643f7](https://github.com/multipliedtwice/prisma-guard/commit/89643f774e88438f1d1111cc2ddd2bed7bc49d3c))

# [1.5.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.4.1...v1.5.0) (2026-04-18)


### Features

* **query-builder-where.ts:** add support for "mode" operator in where clause to enhance query flexibility ([29a30a1](https://github.com/multipliedtwice/prisma-guard/commit/29a30a1268edde324834dc6a2f37ba683cd06b6c))

## [1.4.1](https://github.com/multipliedtwice/prisma-guard/compare/v1.4.0...v1.4.1) (2026-04-01)


### Bug Fixes

* strip forced key from zod ([48df7dd](https://github.com/multipliedtwice/prisma-guard/commit/48df7ddde65dec82567e8166eada054bc5486a64))

# [1.4.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.3.1...v1.4.0) (2026-03-31)


### Features

* **query-builder:** enhance orderBy configuration to support nested objects and validation for scalar fields ([7f879fb](https://github.com/multipliedtwice/prisma-guard/commit/7f879fbbff4b006beba0d4a4b7a1c52b055fdf63))

## [1.3.1](https://github.com/multipliedtwice/prisma-guard/compare/v1.3.0...v1.3.1) (2026-03-31)


### Bug Fixes

* **emit-client.ts:** remove file extension from import statements for consistency and to avoid potential issues with module resolution ([63cd30d](https://github.com/multipliedtwice/prisma-guard/commit/63cd30d79d19ce5c3f96eb09bc756eb0ea982d8d))

# [1.3.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.2.1...v1.3.0) (2026-03-31)


### Features

* **package.json:** update module entry points to support both ESM and CJS formats for better compatibility ([fff2323](https://github.com/multipliedtwice/prisma-guard/commit/fff2323b50edd10dc000c05684b10f03d069506e))

## [1.2.1](https://github.com/multipliedtwice/prisma-guard/compare/v1.2.0...v1.2.1) (2026-03-10)


### Bug Fixes

* security and correctness improvements ([1ba4bfc](https://github.com/multipliedtwice/prisma-guard/commit/1ba4bfc56cf8b6ecccc8aa396e570d84f4d0ebe1))

# [1.2.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.1.0...v1.2.0) (2026-03-09)


### Features

* Logical combinators and Relation filters in where shapes ([29e2d1f](https://github.com/multipliedtwice/prisma-guard/commit/29e2d1fd62257114e591cc6fd680c9c493f2b3a4))

# [1.1.0](https://github.com/multipliedtwice/prisma-guard/compare/v1.0.1...v1.1.0) (2026-03-08)


### Features

* **model-guard.ts:** add support for projection in create, update, and delete methods to enhance data handling flexibility ([dc6c7ec](https://github.com/multipliedtwice/prisma-guard/commit/dc6c7ec6027046ecaca098be41da089fa878f3ce))

## [1.0.1](https://github.com/multipliedtwice/prisma-guard/compare/v1.0.0...v1.0.1) (2026-03-08)


### Bug Fixes

* correctness fixes ([e7c2039](https://github.com/multipliedtwice/prisma-guard/commit/e7c20396f6536a5e137d1a863c4d3261c8486017))

# 1.0.0 (2026-03-07)


### Bug Fixes

* generator test ([1ffe17d](https://github.com/multipliedtwice/prisma-guard/commit/1ffe17d59abf602a333eb1e9bbde2b097a059091))


### Features

* initial release ([6b1af5c](https://github.com/multipliedtwice/prisma-guard/commit/6b1af5c3294c6599e422c5cfb2d38f5a3e07e01f))
* **og.png:** add Open Graph image for improved social media sharing ([7577dc5](https://github.com/multipliedtwice/prisma-guard/commit/7577dc5362f92be08d3bc5a7c10e96d32ef1a07f))

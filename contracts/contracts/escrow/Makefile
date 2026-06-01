default: build

all: test

test: build
	cargo test

build:
	stellar contract build
	@ls -l target/wasm32v1-none/release/*.wasm

fmt:
	cargo fmt --all

clean:
	cargo clean

# Deploy targets
deploy-testnet: build
	@echo "Deploying escrow contract to Stellar testnet..."
	stellar contract deploy \
		--wasm target/wasm32v1-none/release/escrow.wasm \
		--source-account $(STELLAR_ACCOUNT) \
		--network testnet \
		--rpc-url https://soroban-testnet.stellar.org \
		--network-passphrase "Test SDF Network ; September 2015"

deploy-mainnet: build
	@echo "Deploying escrow contract to Stellar mainnet..."
	stellar contract deploy \
		--wasm target/wasm32v1-none/release/escrow.wasm \
		--source-account $(STELLAR_ACCOUNT) \
		--network public \
		--rpc-url https://soroban-mainnet.stellar.org \
		--network-passphrase "Public Global Stellar Network ; September 2015"

.PHONY: default all test build fmt clean deploy-testnet deploy-mainnet

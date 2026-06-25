import { bench, describe } from "vitest";
import { createMuxedAddress } from "./accounts";
import { Keypair } from "@stellar/stellar-sdk";

const basePublicKey = Keypair.random().publicKey();

describe("muxed account slug generation", () => {
  bench(
    "createMuxedAddress - 1000 concurrent calls",
    async () => {
      const promises: Promise<string>[] = [];
      for (let i = 0; i < 1000; i++) {
        promises.push(
          Promise.resolve(createMuxedAddress(basePublicKey, BigInt(i)))
        );
      }
      await Promise.all(promises);
    },
    { iterations: 10 }
  );

  bench(
    "createMuxedAddress - sequential baseline",
    () => {
      for (let i = 0; i < 1000; i++) {
        createMuxedAddress(basePublicKey, BigInt(i));
      }
    },
    { iterations: 10 }
  );

  bench(
    "createMuxedAddress - single call overhead",
    () => {
      createMuxedAddress(basePublicKey, 1234567890123456789n);
    },
    { iterations: 10000 }
  );
});

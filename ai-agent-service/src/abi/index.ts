import userRegistry from "./userRegistry.json" with { type: "json" };
import groupRegistry from "./groupRegistry.json" with { type: "json" };
import Sendrpay from "./Sendrpay.json" with { type: "json" };

export const userRegistryContract = {
  abi: userRegistry,
  address: "0x1264e8ab9E98E2575856B831e606af43BAc0Fe65" as const,
};

export const groupRegistryContract = {
  abi: groupRegistry,
  address: "0x5008A18Adc0F828d1057fb5aF7aD9599fF67f62C" as const,
};

export const sendrpayContract = {
  abi: Sendrpay,
  address: "0x6602F2ee7B05Cc382E654BCAFbB692bd813f9efA" as const,
};

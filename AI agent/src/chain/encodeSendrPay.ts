import { encodeFunctionData } from "viem";
import { sendrpayContract } from "../abi/index.js";

export type EncodedCall = {
  to: `0x${string}`;
  data: `0x${string}`;
  value: `0x${string}`;
  description: string;
};

export function encodePay(
  to: `0x${string}`,
  amountBaseUnits: bigint,
): EncodedCall {
  const data = encodeFunctionData({
    abi: sendrpayContract.abi,
    functionName: "pay",
    args: [to, amountBaseUnits],
  });
  return {
    to: sendrpayContract.address,
    data,
    value: "0x0",
    description: `SendrPay.pay(USDC) → ${to}`,
  };
}

export function encodePayGroupEqual(
  groupId: bigint,
  amountPerMemberBaseUnits: bigint,
): EncodedCall {
  const data = encodeFunctionData({
    abi: sendrpayContract.abi,
    functionName: "payGroupEqual",
    args: [groupId, amountPerMemberBaseUnits],
  });
  return {
    to: sendrpayContract.address,
    data,
    value: "0x0",
    description: `SendrPay.payGroupEqual(group ${groupId}, ${amountPerMemberBaseUnits} per member)`,
  };
}

export function encodePayGroupSplit(
  groupId: bigint,
  totalAmountBaseUnits: bigint,
): EncodedCall {
  const data = encodeFunctionData({
    abi: sendrpayContract.abi,
    functionName: "payGroupSplit",
    args: [groupId, totalAmountBaseUnits],
  });
  return {
    to: sendrpayContract.address,
    data,
    value: "0x0",
    description: `SendrPay.payGroupSplit(group ${groupId}, total ${totalAmountBaseUnits} base units)`,
  };
}

export function encodedCallToJson(c: EncodedCall): {
  to: string;
  data: string;
  value: string;
  description: string;
} {
  return {
    to: c.to,
    data: c.data,
    value: c.value,
    description: c.description,
  };
}

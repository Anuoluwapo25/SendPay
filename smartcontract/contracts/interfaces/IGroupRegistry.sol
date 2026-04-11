// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal surface for `SendrPay` to resolve group members and status.
interface IGroupRegistry {
    function getMembers(uint256 groupId) external view returns (address[] memory);

    function isActive(uint256 groupId) external view returns (bool);
}

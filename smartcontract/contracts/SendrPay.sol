// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IGroupRegistry} from "./interfaces/IGroupRegistry.sol";

/// @title SendrPay
/// @notice Pulls USDC from the payer and sends to one recipient or all members of a group (single tx).
contract SendrPay is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    IGroupRegistry public immutable groupRegistry;

    error GroupNotActive();
    error EmptyMemberList();

    constructor(IERC20 _usdc, IGroupRegistry _groupRegistry, address initialOwner) Ownable(initialOwner) {
        usdc = _usdc;
        groupRegistry = _groupRegistry;
    }

    /// @notice Send `amount` USDC from caller to `to`.
    function pay(address to, uint256 amount) external nonReentrant whenNotPaused {
        usdc.safeTransferFrom(msg.sender, to, amount);
    }

    /// @notice Send `amountPerMember` to every member; total pulled = `amountPerMember * n`.
    function payGroupEqual(uint256 groupId, uint256 amountPerMember) external nonReentrant whenNotPaused {
        if (!groupRegistry.isActive(groupId)) revert GroupNotActive();
        address[] memory members = groupRegistry.getMembers(groupId);
        uint256 n = members.length;
        if (n == 0) revert EmptyMemberList();
        uint256 total = amountPerMember * n;
        usdc.safeTransferFrom(msg.sender, address(this), total);
        for (uint256 i = 0; i < n; i++) {
            usdc.safeTransfer(members[i], amountPerMember);
        }
    }

    /// @notice Split `totalAmount` across members; remainder (from integer division) goes to the first `rem` members (+1 wei each).
    function payGroupSplit(uint256 groupId, uint256 totalAmount) external nonReentrant whenNotPaused {
        if (!groupRegistry.isActive(groupId)) revert GroupNotActive();
        address[] memory members = groupRegistry.getMembers(groupId);
        uint256 n = members.length;
        if (n == 0) revert EmptyMemberList();
        uint256 base = totalAmount / n;
        uint256 rem = totalAmount % n;
        usdc.safeTransferFrom(msg.sender, address(this), totalAmount);
        for (uint256 i = 0; i < n; i++) {
            uint256 share = base + (i < rem ? uint256(1) : 0);
            usdc.safeTransfer(members[i], share);
        }
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}

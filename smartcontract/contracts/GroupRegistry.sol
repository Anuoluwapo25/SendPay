// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IGroupRegistry} from "./interfaces/IGroupRegistry.sol";

/// @title GroupRegistry
/// @notice On-chain groups: create many per owner, add/remove members, cancel, query.
contract GroupRegistry is IGroupRegistry {
    uint256 private _nextGroupId = 1;

    struct Group {
        address owner;
        string name;
        bool active;
    }

    mapping(uint256 groupId => Group) private _groups;
    mapping(uint256 groupId => address[]) private _members;
    mapping(uint256 groupId => mapping(address => bool)) private _isMember;
    mapping(address => uint256[]) private _ownedGroupIds;
    mapping(address => uint256[]) private _memberGroupIds;

    event GroupCreated(uint256 indexed groupId, address indexed owner, string name);
    event MemberAdded(uint256 indexed groupId, address indexed member);
    event MemberRemoved(uint256 indexed groupId, address indexed member);
    event GroupCanceled(uint256 indexed groupId);

    error NotOwner();
    error GroupInactive();
    error GroupNotExists();
    error AlreadyMember();
    error NotMember();
    error InvalidMember();
    error EmptyName();

    modifier onlyGroupOwner(uint256 groupId) {
        if (_groups[groupId].owner == address(0)) revert GroupNotExists();
        if (msg.sender != _groups[groupId].owner) revert NotOwner();
        _;
    }

    /// @notice Create a new group; caller becomes owner. Returns the new `groupId`.
    function createGroup(string calldata name) external returns (uint256 groupId) {
        if (bytes(name).length == 0) revert EmptyName();
        groupId = _nextGroupId++;
        _groups[groupId] = Group({owner: msg.sender, name: name, active: true});
        _ownedGroupIds[msg.sender].push(groupId);
        emit GroupCreated(groupId, msg.sender, name);
    }

    function addMember(uint256 groupId, address member) external onlyGroupOwner(groupId) {
        Group storage g = _groups[groupId];
        if (!g.active) revert GroupInactive();
        if (member == address(0)) revert InvalidMember();
        if (_isMember[groupId][member]) revert AlreadyMember();
        _isMember[groupId][member] = true;
        _members[groupId].push(member);
        _memberGroupIds[member].push(groupId);
        emit MemberAdded(groupId, member);
    }

    function removeMember(uint256 groupId, address member) external onlyGroupOwner(groupId) {
        if (!_isMember[groupId][member]) revert NotMember();
        _isMember[groupId][member] = false;
        _removeFromAddressArray(_members[groupId], member);
        _removeFromUintArray(_memberGroupIds[member], groupId);
        emit MemberRemoved(groupId, member);
    }

    function cancelGroup(uint256 groupId) external onlyGroupOwner(groupId) {
        _groups[groupId].active = false;
        emit GroupCanceled(groupId);
    }

    function getGroup(uint256 groupId)
        external
        view
        returns (address owner, string memory name, bool active)
    {
        Group storage g = _groups[groupId];
        if (g.owner == address(0)) revert GroupNotExists();
        return (g.owner, g.name, g.active);
    }

    /// @inheritdoc IGroupRegistry
    function getMembers(uint256 groupId) external view returns (address[] memory) {
        if (_groups[groupId].owner == address(0)) revert GroupNotExists();
        return _members[groupId];
    }

    function getGroupsOwnedBy(address owner) external view returns (uint256[] memory) {
        return _ownedGroupIds[owner];
    }

    function getGroupsForMember(address member) external view returns (uint256[] memory) {
        return _memberGroupIds[member];
    }

    /// @inheritdoc IGroupRegistry
    function isActive(uint256 groupId) external view returns (bool) {
        Group storage g = _groups[groupId];
        if (g.owner == address(0)) revert GroupNotExists();
        return g.active;
    }

    function _removeFromAddressArray(address[] storage arr, address addr) private {
        uint256 len = arr.length;
        for (uint256 i = 0; i < len; i++) {
            if (arr[i] == addr) {
                arr[i] = arr[len - 1];
                arr.pop();
                return;
            }
        }
    }

    function _removeFromUintArray(uint256[] storage arr, uint256 id) private {
        uint256 len = arr.length;
        for (uint256 i = 0; i < len; i++) {
            if (arr[i] == id) {
                arr[i] = arr[len - 1];
                arr.pop();
                return;
            }
        }
    }
}

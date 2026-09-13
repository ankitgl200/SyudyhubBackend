const express = require('express');
const router = express.Router();
const { Folder, Document } = require('../db/models');
const { auth } = require('../middleware/auth');

// Helper to recursively find all descendant folder IDs
async function getDescendantFolderIds(folderId) {
  let ids = [folderId];
  const children = await Folder.find({ parentId: folderId });
  for (const child of children) {
    const subIds = await getDescendantFolderIds(child._id);
    ids = ids.concat(subIds);
  }
  return ids;
}

// @route   GET api/folders
// @desc    Get all folders (requires auth)
router.get('/', auth, async (req, res) => {
  const { type, parentId } = req.query;
  const query = {};
  
  if (type) {
    if (type === 'simulations' || type === 'roadmaps') {
      query.type = { $in: ['simulations', 'roadmaps'] };
    } else {
      query.type = type;
    }
  }
  if (parentId !== undefined) {
    query.parentId = parentId === 'null' ? null : parentId;
  }

  try {
    const folders = await Folder.find(query);
    res.json(folders.map(f => ({
      id: f._id,
      name: f.name,
      type: f.type,
      parentId: f.parentId,
      createdAt: f.createdAt
    })));
  } catch (err) {
    res.status(500).json({ message: 'Server error loading folders' });
  }
});

// @route   POST api/folders
// @desc    Create a folder (Admin/Teacher for roadmaps, Admin only for others)
router.post('/', auth, async (req, res) => {
  const { name, type, parentId } = req.body;

  if (!name || !type) {
    return res.status(400).json({ message: 'Folder name and type are required' });
  }

  // Dynamic authorization check
  if (type === 'roadmaps' || type === 'simulations') {
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin' && req.user.role !== 'educator') {
      return res.status(403).json({ message: 'Access denied: Teacher or Admin privileges required' });
    }
  } else {
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ message: 'Access denied: Admin privileges required' });
    }
  }

  try {
    const folder = new Folder({
      name,
      type,
      parentId: parentId || null
    });
    
    await folder.save();

    res.status(201).json({
      id: folder._id,
      name: folder.name,
      type: folder.type,
      parentId: folder.parentId,
      createdAt: folder.createdAt
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error creating folder' });
  }
});

// @route   PUT api/folders/:id
// @desc    Update/Rename a folder (Admin/Teacher for roadmaps, Admin only for others)
router.put('/:id', auth, async (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ message: 'Folder name is required' });
  }

  try {
    const folder = await Folder.findById(req.params.id);
    if (!folder) {
      return res.status(404).json({ message: 'Folder not found' });
    }

    // Dynamic authorization check
    if (folder.type === 'roadmaps' || folder.type === 'simulations') {
      if (req.user.role !== 'admin' && req.user.role !== 'superadmin' && req.user.role !== 'educator') {
        return res.status(403).json({ message: 'Access denied: Teacher or Admin privileges required' });
      }
    } else {
      if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
        return res.status(403).json({ message: 'Access denied: Admin privileges required' });
      }
    }

    folder.name = name;
    await folder.save();

    res.json({
      id: folder._id,
      name: folder.name,
      type: folder.type,
      parentId: folder.parentId,
      createdAt: folder.createdAt
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error updating folder' });
  }
});

// @route   DELETE api/folders/:id
// @desc    Delete folder and cascade delete its contents (Admin/Teacher for roadmaps, Admin only for others)
router.delete('/:id', auth, async (req, res) => {
  const folderId = req.params.id;

  try {
    const folder = await Folder.findById(folderId);
    if (!folder) {
      return res.status(404).json({ message: 'Folder not found' });
    }

    // Dynamic authorization check
    if (folder.type === 'roadmaps' || folder.type === 'simulations') {
      if (req.user.role !== 'admin' && req.user.role !== 'superadmin' && req.user.role !== 'educator') {
        return res.status(403).json({ message: 'Access denied: Teacher or Admin privileges required' });
      }
    } else {
      if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
        return res.status(403).json({ message: 'Access denied: Admin privileges required' });
      }
    }

    // Recursively find all child subfolder IDs
    const folderIdsToDelete = await getDescendantFolderIds(folderId);

    // Cascade delete all documents inside any of these folders
    await Document.deleteMany({ folderId: { $in: folderIdsToDelete } });

    // Delete the folders
    await Folder.deleteMany({ _id: { $in: folderIdsToDelete } });

    res.json({ message: 'Folder and all contents deleted successfully', folderId });
  } catch (err) {
    console.error('Delete folder error:', err);
    res.status(500).json({ message: 'Server error deleting folder' });
  }
});

module.exports = router;

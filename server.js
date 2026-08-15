const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const config = require('./config');

const app = express();

// Enable CORS
app.use(cors());

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure public/uploads directory exists
const UPLOADS_DIR = config.UPLOADS_DIR;
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Serve static uploads
app.use('/uploads', express.static(UPLOADS_DIR));

// Serve frontend static folder if it exists (allows local integrated testing)
const frontendPath = path.join(__dirname, '..', 'frontend');
const publicPath = path.join(__dirname, 'public');
const targetStaticPath = fs.existsSync(frontendPath) ? frontendPath : (fs.existsSync(publicPath) ? publicPath : null);

if (targetStaticPath) {
  app.use(express.static(targetStaticPath));
  
  // SPA routing fallback - serve index.html for non-API requests
  app.get(/^(?!\/api|\/uploads).*/, (req, res) => {
    res.sendFile(path.join(targetStaticPath, 'index.html'));
  });
}

// Health Check Route
app.get("/health", (req, res) => {
res.status(200).json({
success: true,
message: "Server is healthy",
timestamp: new Date().toISOString(),
});
});

// Import routes
const authRoutes = require('./routes/auth');
const folderRoutes = require('./routes/folders');
const documentRoutes = require('./routes/documents');
const announcementRoutes = require('./routes/announcements');
const helpRoutes = require('./routes/help');
const notificationRoutes = require('./routes/notifications');
const sonicRoutes = require('./routes/sonic');
const reviewRoutes = require('./routes/reviews');

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/help', helpRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/sonic', sonicRoutes);
app.use('/api/reviews', reviewRoutes);

// Seed default data using Mongoose
async function seedDefaultData() {
  try {
    const { User, Folder, MessageTemplate } = require('./db/models');

    // 1. Seed Permanent Super Admin
    const superAdminPhone = '8218325600';
    const existingSuperAdmin = await User.findOne({ phone: superAdminPhone });
    
    if (!existingSuperAdmin) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('ankit@2004', salt);
      
      const newAdmin = new User({
        name: 'ankit Ghugtyal',
        phone: superAdminPhone,
        password: hashedPassword,
        role: 'superadmin',
        approved: true
      });
      await newAdmin.save();

    }

    // 3. Seed default subject folders if empty
    // Notes folders
    const notesFoldersCount = await Folder.countDocuments({ type: 'notes' });
    if (notesFoldersCount === 0) {
      const defaultNotes = [
        'Engineering Mathematics',
        'Engineering Physics',
        'Computer Programming',
        'Data Structures'
      ];
      await Folder.insertMany(defaultNotes.map(name => ({ name, type: 'notes', parentId: null })));
      console.log('Seeded default Notes folders');
    }

    // Papers folders
    const papersFoldersCount = await Folder.countDocuments({ type: 'papers' });
    if (papersFoldersCount === 0) {
      const defaultPapers = [
        'Mathematics PYQs',
        'Physics PYQs',
        'Chemistry PYQs',
        'Computer Science PYQs'
      ];
      await Folder.insertMany(defaultPapers.map(name => ({ name, type: 'papers', parentId: null })));
      console.log('Seeded default Papers folders');
    }

    // Lab Manual folders
    const labFoldersCount = await Folder.countDocuments({ type: 'lab_manuals' });
    if (labFoldersCount === 0) {
      const defaultLabs = [
        'Basic Programming Lab',
        'Physics Practical Lab',
        'Data Structures Lab'
      ];
      await Folder.insertMany(defaultLabs.map(name => ({ name, type: 'lab_manuals', parentId: null })));
      console.log('Seeded default Lab Manual folders');
    }

    // Books folders
    const bookFoldersCount = await Folder.countDocuments({ type: 'books' });
    if (bookFoldersCount === 0) {
      const defaultBooks = [
        'Calculus & Algebra',
        'Programming in C',
        'Introduction to Algorithms'
      ];
      await Folder.insertMany(defaultBooks.map(name => ({ name, type: 'books', parentId: null })));
      console.log('Seeded default Book folders');
    }

    // Roadmap folders
    const roadmapFoldersCount = await Folder.countDocuments({ type: 'roadmaps' });
    if (roadmapFoldersCount === 0) {
      const defaultRoadmaps = [
        'Computer Science Roadmap',
        'Information Technology Roadmap',
        'Electronics & Communication Roadmap'
      ];
      await Folder.insertMany(defaultRoadmaps.map(name => ({ name, type: 'roadmaps', parentId: null })));
      console.log('Seeded default Roadmap folders');
    }

    // 4. Seed default message templates
    const templatesCount = await MessageTemplate.countDocuments();
    if (templatesCount === 0) {
      const defaultTemplates = [
        {
          name: 'Welcome Educator',
          content: 'Dear Sir/Ma’am,\n\nWe warmly welcome you to our platform as an educator and sincerely thank you for joining us. Your presence and experience will greatly benefit our student community.\n\nWe kindly request you to upload any resources you have, such as notes, previous year questions, or lab manuals, which can help students in their learning journey.\n\nIn case you face any issues while using the platform or otherwise, please feel free to use the Help & Support page—we are always here to assist you.\n\nThank you once again for being a valuable part of our initiative.'
        },
        {
          name: 'Request Upload',
          content: 'Dear Student/Educator,\n\nWe noticed that some resources (notes, PYQs, or lab manuals) for your department/year are currently missing. If you have access to these materials, we kindly request you to upload them to the portal to assist other learners.\n\nThank you for your cooperation!'
        }
      ];
      await MessageTemplate.insertMany(defaultTemplates);
      console.log('Seeded default message templates');
    }

  } catch (err) {
    console.error('Error during data seeding:', err.message);
  }
}

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Internal Server Error' });
});

// Connect to MongoDB & Start Server
mongoose.connect(config.MONGODB_URI)
  .then(async () => {
    console.log('Connected to MongoDB successfully.');
    await seedDefaultData();
    
    const PORT = config.PORT;
    app.listen(PORT, () => {
      console.log(`Studyhub Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Database connection failed:', err.message);
    process.exit(1);
  });

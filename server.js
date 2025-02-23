const express = require("express");
const xlsx = require("xlsx");
const path = require("path");
const cors = require('cors');
const Papa = require('papaparse');  // Required for CSV data processing
const fs = require('fs');  // Required for file system operations
const connectDB = require("./db/connectDB");
const User = require("./db/userModel");
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 3000;

// Middleware to parse JSON requests
app.use(cors());
app.use(express.json());

connectDB();


// Load dataset from server
const FILE_PATH = path.join(__dirname, "NEET.xlsx");
const filePathBITS = path.join(__dirname, "BITSAT.csv");
let dfBITS = [];
const filePathCET = 'CET.csv';
const fileContent = fs.readFileSync(filePathCET, 'utf8');
const filePath = path.join(__dirname, "JEE.xlsx");
const workbook = xlsx.readFile(filePath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
let df = xlsx.utils.sheet_to_json(sheet);
const parsedCsv = Papa.parse(fileContent, { header: true, dynamicTyping: true });
const dfCET = parsedCsv.data; 
const filePathCAT = path.join(__dirname, "IIM.xlsx");
const workbookCAT = xlsx.readFile(filePathCAT);
const sheetCAT = workbookCAT.Sheets[workbookCAT.SheetNames[0]];
let dfCAT = xlsx.utils.sheet_to_json(sheetCAT);

const FILE_PATH_LAW = path.join(__dirname, "CLAT_Updated.xlsx");

// Function to read and recommend colleges
const recommendCollegesLAW = (category, rank) => {
  // Load the Excel file
  const workbook = xlsx.readFile(FILE_PATH_LAW);
  const sheetName = workbook.SheetNames[0];
  const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

  // Category mapping
  const categoryKeywords = {
      "General": "General",
      "OBC": "OBC",
      "SC": "SC",
      "ST": "ST"
  };

  if (!categoryKeywords[category]) {
      return { error: `Invalid category. Choose from General, OBC, SC, ST.` };
  }

  // Find the correct column for the category
  let matchedCol = Object.keys(sheet[0]).find(col => col.includes(categoryKeywords[category]));
  if (!matchedCol) {
      return { error: `No matching column found for category '${category}'.` };
  }

  // Filter colleges within rank cutoff
  let filteredColleges = sheet
      .map(row => ({
          name: row["NLUs"],
          closingRank: parseInt(row[matchedCol])
      }))
      .filter(row => !isNaN(row.closingRank) && rank <= row.closingRank)
      .sort((a, b) => a.closingRank - b.closingRank)
      .slice(0, 5);

  return filteredColleges.length ? filteredColleges : { message: "No colleges found for the given rank." };
};

app.post("/recommend/LAW", (req, res) => {
  const { category, rank } = req.body;

  if (!category || rank === undefined) {
      return res.status(400).json({ error: "Category and rank are required." });
  }

  const recommendations = recommendCollegesLAW(category, rank);
  res.json({recommendations});
});

dfCAT = dfCAT.map((row) => ({
    name: row["NAME"],
    category: row["CATEGORY"]?.trim().toLowerCase(),
    varc: Number(row["VARC"]) || Infinity,
    lrdi: Number(row["LRDI"]) || Infinity,
    qa: Number(row["QA"]) || Infinity,
    overall: Number(row["OVERALL"]) || Infinity,
  }));

const loadCSVData = () => {
    return new Promise((resolve, reject) => {
      const file = fs.readFileSync(filePathBITS, "utf8"); // Read the file synchronously
      Papa.parse(file, {
        header: true,  // Parse the first row as headers
        skipEmptyLines: true,
        complete: (result) => {
          dfBITS = result.data; // Store parsed data in df
          // Standardize column names and normalize branch names
          dfBITS.forEach((row) => {
            row["Campus"] = row["Campus"] ? row["Campus"].trim() : "";
            row["Program"] = row["Program"]
              ? row["Program"].replace(/^(B\.E\.|M\.Sc\.)\s*/, "").trim()
              : "";
          });
          resolve();
        },
        error: (err) => {
          reject(err);
        },
      });
    });
  };


  loadCSVData()
  .then(() => {
    console.log("CSV file loaded and parsed.");
  })
  .catch((err) => {
    console.error("Error loading CSV:", err);
  });
// Data Preprocessing
df = df.map((row) => ({
  institute: row["Institute"],
  academic_program_name: row["Academic Program Name"]?.trim().toLowerCase(),
  closing_rank: Number(row["Closing Rank"]) || Infinity,
  gender: row["Gender"]?.trim().toLowerCase(),
  seat_type: row["Seat Type"]?.trim().toLowerCase(),
  quota: row["Quota"]?.trim().toLowerCase(),
  program_cleaned: row["Academic Program Name"]
    ?.replace(/\(.*?\)/g, "")
    .trim()
    .toLowerCase(),
}));

function loadDataset() {
    try {
        const workbook = xlsx.readFile(FILE_PATH);
        const sheetName = workbook.SheetNames[0]; // Assuming data is in the first sheet
        let data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        // Normalize column names (strip spaces, convert to uppercase)
        data = data.map(row => {
            let newRow = {};
            for (let key in row) {
                newRow[key.trim().toUpperCase()] = row[key];
            }
            return newRow;
        });

        // Rename AIIMS column to MBBS COLLEGES IN INDIA
        if (data.length > 0 && "AIIMS COLLEGES IN INDIA" in data[0]) {
            data = data.map(row => ({
                ...row,
                "MBBS COLLEGES IN INDIA": row["AIIMS COLLEGES IN INDIA"],
            }));
        }

        return data;
    } catch (error) {
        console.error("Error loading dataset:", error);
        return [];
    }
}

function recommendCollegesNEET(category, rank, topN = 10) {
    const data = loadDataset();
    if (!data.length) return [];

    category = category.trim().toUpperCase();

    // Check if category exists in dataset
    if (!data.some(row => category in row)) {
        return { error: `Invalid category: ${category}. Available categories: ${Object.keys(data[0]).slice(1).join(", ")}` };
    }

    // Convert category values to numbers (ignore non-numeric values)
    const filteredData = data
        .map(row => ({
            college: row["MBBS COLLEGES IN INDIA"],
            closingRank: Number(row[category]) || Infinity,
        }))
        .filter(row => row.closingRank >= rank)
        .sort((a, b) => a.closingRank - b.closingRank)
        .slice(0, topN);

    return filteredData;
}


function recommendColleges(df, category, gender, rank, preferredBranches, topN = 20) {
    // Filter by category and gender
    let filteredDf = df.filter(row => row['category'] === category && row['gender'] === gender);

    // Filter by preferred branches
    if (preferredBranches.length > 0) {
        filteredDf = filteredDf.filter(row => preferredBranches.includes(row['branch']));
    }

    // Remove colleges with a closing rank lower than the input rank
    filteredDf = filteredDf.filter(row => row['Rank'] >= rank);

    // Sort by rank (closest to input rank)
    filteredDf = filteredDf.sort((a, b) => Math.abs(a['Rank'] - rank) - Math.abs(b['Rank'] - rank));

    const finalDf = filteredDf
    .reduce((acc, row) => {
        if (!acc[row['college_name']]) {
            acc[row['college_name']] = { college_name: row['college_name'], branch: row['branch'], Rank: row['Rank'] };
        } else {
            if (row['Rank'] > acc[row['college_name']].Rank) {
                acc[row['college_name']] = { college_name: row['college_name'], branch: row['branch'], Rank: row['Rank'] };
            }
        }
        return acc;
    }, {});


    // Convert to array and sort by rank
    const sortedDf = Object.values(finalDf)
        .sort((a, b) => a['Rank'] - b['Rank'])
        .slice(0, topN);

    return sortedDf;
}

app.post('/recommend/CET', (req, res) => {
    const { category, gender, rank, preferred_branches } = req.body;

    // Ensure all required parameters are provided
    if (!category || !gender || !rank || !preferred_branches) {
        return res.status(400).json({ error: 'All parameters are required.' });
    }

    const rankNum = parseInt(rank, 10);

    // Get recommendations based on the user inputs
    const recommendedColleges = recommendColleges(dfCET, category, gender, rankNum, preferred_branches);

    // Prepare the response with only college name, branch, and rank
    const recommendations = recommendedColleges.map(college => {
        return {
            college_name: college['college_name'],
            branch: college['branch'],
            rank: college['Rank']
        };
    });

    // Send the recommendations as a JSON response
    return res.json({ recommendations });
});

app.get("/health-check", (req,res)=>{
  res.status(200).json({message:"ok"});
})

// API Endpoint (POST request)
app.post("/recommend/JEE", (req, res) => {
  const { category, jee_rank, gender, programs } = req.body;

  if (!category || !jee_rank || !gender || !programs) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  const rank = parseInt(jee_rank, 10);

  const programList = programs.map((p) => p.trim().toLowerCase());

  // Filter dataset
  const filtered = df
    .filter(
      (row) =>
        row.closing_rank >= rank &&
        row.gender.includes(gender.toLowerCase()) &&
        row.seat_type.includes(category.toLowerCase()) &&
        row.quota.includes("os") &&
        programList.includes(row.program_cleaned)
    )
    .sort((a, b) => a.closing_rank - b.closing_rank) // Sort by rank
    .slice(0, 10); // Return top 10

  if (filtered.length === 0) {
    return res.json({ message: "No colleges found matching your criteria" });
  }

  return res.json({ recommendations: filtered });
});

app.post("/recommend/CAT", (req, res) => {
    const { category, varc, lrdi, qa, overall } = req.body;
  
    if (!category || varc === undefined || lrdi === undefined || qa === undefined || overall === undefined) {
      return res.status(400).json({ error: "Missing required parameters" });
    }
  
    // Filter dataset
    const filtered = dfCAT
      .filter(
        (row) =>
          row.category === category.trim().toLowerCase() &&
          row.varc <= varc &&
          row.lrdi <= lrdi &&
          row.qa <= qa &&
          row.overall <= overall
      )
      .sort((a, b) => a.overall - b.overall) // Sort by overall score (ascending)
      .slice(0, 10); // Return top 10
  
    if (filtered.length === 0) {
      return res.json({ message: "No IIMs found matching your criteria" });
    }
  
    return res.json({ recommendations: filtered });
  });

app.post("/recommend/NEET", (req, res) => {
    const { category, rank } = req.body;

    if (!category || rank == null || isNaN(rank)) {
        return res.status(400).json({ error: "Invalid input. Please provide category and rank as a number." });
    }

    const recommendations = recommendCollegesNEET(category, parseInt(rank));

    if (recommendations.error) {
        return res.status(400).json(recommendations);
    }

    return res.json({ recommendations });
});


// BITSAT recommendation endpoint
app.post("/recommend/BITSAT", (req, res) => {
    const { marks, branch_interests } = req.body;
    //   console.log(df);
    if (!marks || !branch_interests || !Array.isArray(branch_interests)) {
      return res.status(400).json({
        error: "Invalid input. Please provide marks and an array of branch interests.",
      });
    }
  
    const normalizedBranchInterests = branch_interests.map((branch) =>
      branch.trim().toLowerCase()
    );
  
  //   console.log("normalized ", normalizedBranchInterests);
  
    // Filter the dataset based on cutoff score
    const eligibleBranches = dfBITS.filter(
      (row) => Number(row["Cut-off Score"]) <= marks
    );
  
    // Further filter based on branch interests
    const filteredBranches = eligibleBranches.filter((row) => {
      return normalizedBranchInterests.some((interest) =>
        row["Program"].toLowerCase().includes(interest)
      );
    });
  
    // Sort by cutoff score in descending order
    filteredBranches.sort((a, b) => Number(b["Cut-off Score"]) - Number(a["Cut-off Score"]));
  
    // Get top N recommendations (default 10)
    const topN = 10;
    const topBranches = filteredBranches
      .slice(0, topN)
      .map((row) => ({
        campus: row["Campus"],
        branch: row["Program"],
        cutoffScore: row["Cut-off Score"],
      }));
  
    // Return the recommendations
    if (topBranches.length > 0) {
      return res.json({ recommendations: topBranches });
    } else {
      return res.json({
        message: "No eligible branches found for the given marks and preferences.",
      });
    }
  });


app.post('/signup', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Check if user already exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const newUser = new User({
      email,
      password: hashedPassword,
    });

    // Save user to database
    await newUser.save();

    // Send success response
    res.status(201).json({ message: 'User created successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign({ userId: user._id }, 'your_jwt_secret', { expiresIn: '1h' });

    // Send response with token
    res.json({ message: 'Login successful', token });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

const authenticate = (req, res, next) => {
  // Extract token from the Authorization header
  const token = req.headers['authorization'] && req.headers['authorization'].split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  // Verify the token
  jwt.verify(token, 'your_jwt_secret', async (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }

    // Store the userId from the token in the request object
    req.userId = decoded.userId;
    next();
  });
};


app.get('/profile', authenticate, async (req, res) => {
  try {
    // Find the user by userId (extracted from the token)
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Return user details (exclude password from the response)
    const { password, ...userDetails } = user.toObject();
    res.json(userDetails);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/profile', authenticate, async (req, res) => {
  const { name, phone, city, dob, password } = req.body;

  try {
    // Find user by userId (from the token)
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update the user fields if provided
    if (name) user.name = name;
    if (phone) user.phone = phone;
    if (city) user.city = city;
    if (dob) user.dob = dob;

    // If a new password is provided, hash it and update
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      user.password = hashedPassword;
    }

    // Save the updated user
    await user.save();

    // Return updated user data (excluding the password)
    const { password: userPassword, ...updatedUser } = user.toObject();
    res.json(updatedUser);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});


// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

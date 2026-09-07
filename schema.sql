DROP TABLE IF EXISTS contacts;
DROP TABLE IF EXISTS danger_zones;

CREATE TABLE contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    relation TEXT NOT NULL
);

CREATE TABLE danger_zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    radius INTEGER NOT NULL,
    risk TEXT NOT NULL,
    description TEXT
);
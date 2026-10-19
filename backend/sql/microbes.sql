-- Purpose: Provides a small SQLite seed script used for database-source generation tests and demos.
-- save as microbes.sql (SQLite compatible)
CREATE TABLE bacteria_counts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bacteria TEXT NOT NULL,
    count INTEGER NOT NULL
);

INSERT INTO bacteria_counts (bacteria, count) VALUES
('E.coli', 150),
('S.aureus', 80),
('L.monocytogenes', 45),
('Salmonella', 60);
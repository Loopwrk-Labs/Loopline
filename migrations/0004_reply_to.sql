-- Links a message to the message it answers (Prepiska "Odgovori" on a card).
ALTER TABLE correspondence ADD COLUMN reply_to TEXT REFERENCES correspondence(id);

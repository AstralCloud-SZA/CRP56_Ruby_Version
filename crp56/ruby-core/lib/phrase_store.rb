# frozen_string_literal: true

require "json"
require "securerandom"

module CRP56
  class PhraseStore
    attr_reader :phrases

    def initialize(phrases = nil)
      @phrases = normalize_phrases(phrases || default_phrase_hash)
    end

    def self.load(path)
      raise PhraseStoreError, "Phrase store path cannot be nil or empty." if blank_path?(path)
      raise PhraseStoreError, "Phrase store file not found: #{path}" unless File.exist?(path)

      raw = File.read(path)
      data = JSON.parse(raw)

      new(data)
    rescue JSON::ParserError => e
      raise PhraseStoreError, "Failed to parse phrase store JSON: #{e.message}"
    end

    def save(path)
      raise PhraseStoreError, "Phrase store path cannot be nil or empty." if self.class.send(:blank_path?, path)

      File.write(path, JSON.pretty_generate(@phrases))
    end

    def valid?
      return false unless phrases.is_a?(Hash)
      return false unless phrases.keys.sort == expected_keys

      expected_keys.all? do |key|
        value = phrases[key]
        value.is_a?(String) && !value.strip.empty?
      end
    end

    def validate!
      return true if valid?

      raise PhraseStoreError,
            "Phrase store is invalid. Exactly #{Constants::KEY_PHRASE_SLOTS} non-empty phrases are required."
    end

    def get_phrase(slot_index)
      validate_slot_index!(slot_index)

      value = phrases[slot_key(slot_index)]
      if value.nil? || value.strip.empty?
        raise PhraseStoreError, "Phrase slot #{slot_index} is empty or missing."
      end

      value
    end

    def set_phrase(slot_index, phrase)
      validate_slot_index!(slot_index)

      if phrase.nil? || phrase.strip.empty?
        raise PhraseStoreError, "Phrase cannot be nil or empty."
      end

      phrases[slot_key(slot_index)] = phrase
    end

    def random_slot_picker
      SecureRandom.random_number(Constants::KEY_PHRASE_SLOTS)
    end

    def to_a
      (0...Constants::KEY_PHRASE_SLOTS).map { |index| get_phrase(index) }
    end

    private

    def normalize_phrases(input)
      normalized = default_phrase_hash

      input.each do |key, value|
        normalized[normalize_key(key)] = value
      end

      normalized
    end

    def default_phrase_hash
      (0...Constants::KEY_PHRASE_SLOTS).each_with_object({}) do |index, hash|
        hash[slot_key(index)] = ""
      end
    end

    def expected_keys
      (0...Constants::KEY_PHRASE_SLOTS).map { |index| slot_key(index) }
    end

    def slot_key(index)
      "slot_#{index}"
    end

    def normalize_key(key)
      string_key = key.to_s.strip

      return string_key if string_key.match?(/\Aslot_[0-5]\z/)

      if string_key.match?(/\A\d+\z/)
        return slot_key(string_key.to_i)
      end

      string_key
    end

    def validate_slot_index!(slot_index)
      unless slot_index.is_a?(Integer) && slot_index >= 0 && slot_index < Constants::KEY_PHRASE_SLOTS
        raise PhraseStoreError,
              "Invalid slot index #{slot_index.inspect}. Must be between 0 and #{Constants::KEY_PHRASE_SLOTS - 1}."
      end
    end

    def self.blank_path?(path)
      path.nil? || path.to_s.strip.empty?
    end
  end
end
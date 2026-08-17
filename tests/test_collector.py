import unittest

from scripts.collector import parse_club_record


class ParseClubRecordTests(unittest.TestCase):
    def test_returns_occupancy_and_status_from_entity_encoded_react_props(self):
        page = '''
        <div
          data-react-props="{&quot;club&quot;:{&quot;current_occupancy&quot;:34,&quot;occupancy_status&quot;:&quot;light&quot;}}"
        ></div>
        '''

        self.assertEqual(parse_club_record(page), (34, "light"))

    def test_rejects_a_page_without_react_props(self):
        with self.assertRaises(ValueError):
            parse_club_record("<main>Crunch E 81st St</main>")

    def test_rejects_negative_occupancy(self):
        page = '''
        <div
          data-react-props="{&quot;club&quot;:{&quot;current_occupancy&quot;:-1,&quot;occupancy_status&quot;:&quot;light&quot;}}"
        ></div>
        '''

        with self.assertRaises(ValueError):
            parse_club_record(page)


if __name__ == "__main__":
    unittest.main()

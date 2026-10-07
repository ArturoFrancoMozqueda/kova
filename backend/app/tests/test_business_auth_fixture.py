from app.auth import service


def test_business_fixture_keeps_real_password_verification(fast_business_auth):
    hashed = service.hash_password("test-only-password")
    assert hashed.split("$")[2] == "04"
    assert service.verify_password("test-only-password", hashed)
    assert not service.verify_password("wrong-password", hashed)


def test_production_password_cost_and_dummy_hash_are_restored():
    assert service._BCRYPT_ROUNDS == 12
    assert service._DUMMY_PASSWORD_HASH.split("$")[2] == "12"
